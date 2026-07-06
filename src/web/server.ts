// Public prototype web layer. Deliberately: no framework, no database, no auth,
// no queue. One pipeline run at a time, synchronous, inside one streamed
// request/response. This file is presentation plumbing + public-exposure
// guards only — the pipeline itself is imported, never reimplemented.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { sendSnapshotEmail, EmailNotConfiguredError } from "../email.js";
import { loadEnv } from "../llm/client.js";
import { findRunLogByRunId, updateRunLog } from "../logger.js";
import { runPipeline } from "../pipeline.js";
import { dailyBudgetCheck, rateLimitCheck, recordSpend } from "./guards.js";

const WEB_DIR = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);

loadEnv();
let busy = false; // one run at a time — deliberate, not a missing feature

// Real pipeline stages -> visitor-facing Waiting Room milestones. These fire
// when the stage actually starts — no artificial timers, no fake narration.
const MILESTONES: [prefix: string, label: string][] = [
  ["Contract 0", "Confirming your website is reachable"],
  ["Site corpus", "Reading your website's pages"],
  ["Contract 1", "Identifying your business"],
  ["Contract 2", "Understanding what your business is trying to achieve"],
  ["Contract 3", "Gathering evidence about your online presence"],
  ["Contract 4", "Reasoning about what's most limiting your growth"],
  ["Contract 5", "Writing your Growth Snapshot"],
];

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function clientIp(req: IncomingMessage): string {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.length) return fwd.split(",")[0].trim();
  return req.socket.remoteAddress ?? "unknown";
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 10_000) throw new Error("Request too large");
  }
  return body ? (JSON.parse(body) as Record<string, unknown>) : {};
}

async function handleSnapshot(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const ip = clientIp(req);
  const rate = rateLimitCheck(ip);
  if (!rate.allowed) {
    json(res, 429, { type: "error", state: "rate_limited", message: rate.message });
    return;
  }
  const budget = dailyBudgetCheck();
  if (!budget.allowed) {
    json(res, 503, { type: "error", state: "daily_capacity", message: budget.message });
    return;
  }
  if (busy) {
    json(res, 503, {
      type: "error",
      state: "busy",
      message: "We're preparing another Growth Snapshot right now — please try again in a minute.",
    });
    return;
  }
  busy = true;
  try {
    const url = String((await readBody(req)).url ?? "").trim();
    if (!url) {
      json(res, 400, { type: "error", state: "input_failed", message: "Please enter a business website URL." });
      return;
    }

    // NDJSON stream: milestone events as the pipeline actually progresses,
    // then one final result/error line.
    res.writeHead(200, {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
    });
    const write = (obj: unknown) => res.write(JSON.stringify(obj) + "\n");

    const seen = new Set<string>();
    const { log } = await runPipeline(url, (event) => {
      if (!event.endsWith("— started")) return;
      const m = MILESTONES.find(([prefix]) => event.startsWith(prefix));
      if (m && !seen.has(m[0])) {
        seen.add(m[0]);
        write({ type: "milestone", label: m[1] });
      }
    });

    if (log.llmUsage && log.llmUsage.totals.estimatedCostUsd > 0) {
      recordSpend(log.llmUsage.totals.estimatedCostUsd);
    }

    if (log.failure?.stage === "configuration") {
      write({
        type: "error",
        state: "llm_not_configured",
        message:
          "This prototype requires a configured LLM provider to generate a real Growth Snapshot. No provider is currently configured, so the analysis could not run.",
      });
    } else if (log.failure?.stage === "Contract 0") {
      write({ type: "error", state: "input_failed", message: `We couldn't reach that website: ${log.failure.reason}` });
    } else if (log.failure?.stage === "budget") {
      write({
        type: "error",
        state: "budget",
        message: "This analysis hit its cost ceiling and stopped safely. Please try again later.",
      });
    } else if (log.failure) {
      write({
        type: "error",
        state: "error",
        message: `The analysis could not be completed (${log.failure.stage}): ${log.failure.reason}`,
      });
    } else {
      write({
        type: "result",
        state: "snapshot",
        mockMode: (process.env.DRDS_LLM_PROVIDER || "anthropic").toLowerCase() === "mock",
        runId: log.runId,
        businessName: log.cip?.businessName,
        snapshot: log.growthSnapshot,
      });
    }
    res.end();
  } catch (err) {
    if (!res.headersSent) {
      json(res, 500, { type: "error", state: "error", message: err instanceof Error ? err.message : String(err) });
    } else {
      res.end(JSON.stringify({ type: "error", state: "error", message: err instanceof Error ? err.message : String(err) }) + "\n");
    }
  } finally {
    busy = false;
  }
}

async function handleEmail(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const body = await readBody(req);
    const runId = String(body.runId ?? "");
    const email = String(body.email ?? "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      json(res, 400, { state: "invalid_email", message: "Please enter a valid email address." });
      return;
    }
    const found = findRunLogByRunId(runId);
    if (!found || !found.log.growthSnapshot) {
      json(res, 404, { state: "not_found", message: "We couldn't find that Snapshot. Please run the analysis again." });
      return;
    }
    if (found.log.emailDelivery?.status === "sent") {
      json(res, 200, { state: "already_sent", message: "This Snapshot has already been emailed." });
      return;
    }
    try {
      const sent = await sendSnapshotEmail(
        email,
        found.log.cip?.businessName ?? found.log.input.normalisedBusinessIdentifier,
        found.log.growthSnapshot
      );
      found.log.emailDelivery = { to: email, sentAt: new Date().toISOString(), provider: sent.provider, status: "sent" };
      updateRunLog(found.file, found.log);
      json(res, 200, { state: "sent", message: "Done — your Growth Snapshot is on its way to your inbox." });
    } catch (err) {
      if (err instanceof EmailNotConfiguredError) {
        json(res, 200, { state: "email_not_configured", message: err.message });
        return;
      }
      found.log.emailDelivery = {
        to: email,
        sentAt: new Date().toISOString(),
        provider: "resend",
        status: "failed",
        detail: err instanceof Error ? err.message : String(err),
      };
      updateRunLog(found.file, found.log);
      json(res, 502, {
        state: "send_failed",
        message: "We couldn't send the email right now. Your Snapshot is still shown above — nothing was lost.",
      });
    }
  } catch (err) {
    json(res, 500, { state: "error", message: err instanceof Error ? err.message : String(err) });
  }
}

const server = createServer(async (req, res) => {
  if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(readFileSync(join(WEB_DIR, "index.html"), "utf8"));
    return;
  }
  if (req.method === "POST" && req.url === "/api/snapshot") return handleSnapshot(req, res);
  if (req.method === "POST" && req.url === "/api/email") return handleEmail(req, res);
  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not found");
});

server.listen(PORT, () => {
  const provider = (process.env.DRDS_LLM_PROVIDER || "anthropic").toLowerCase();
  console.log(`DRDS prototype: http://localhost:${PORT}  (LLM provider: ${provider}, email: ${process.env.RESEND_API_KEY ? "configured" : "NOT configured"})`);
});
