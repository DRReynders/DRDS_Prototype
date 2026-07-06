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

// Sprint 2 Stage 1: no raw provider/infrastructure/exception text ever reaches
// the visitor. The full technical detail is still written to the per-run log
// file (log.failure, log.stages) and to stdout here (see logRunSummary) — this
// function only controls what the client is shown.
const GENERIC_FAILURE_MESSAGE =
  "We couldn't complete this Growth Audit just now. This is usually temporary — please try again shortly.";

function clientFacingFailureMessage(failure: { stage: string; reason: string }): { state: string; message: string } {
  switch (failure.stage) {
    case "Contract 0":
      if (failure.reason.startsWith("Empty input")) {
        return { state: "input_failed", message: "Please enter a business website URL." };
      }
      if (failure.reason.startsWith("Input could not be parsed")) {
        return {
          state: "input_failed",
          message: "That doesn't look like a valid website address. Please check it and try again.",
        };
      }
      // Any other Contract 0 failure is a reachability/fetch/timeout problem —
      // the underlying reason may contain raw fetch/network exception text
      // (see fetcher.ts), so it is never interpolated into this message.
      return {
        state: "input_failed",
        message: "We couldn't reach that website just now. Please double-check the address, or try again in a moment.",
      };
    case "Contract 1":
      // CannotIdentifyError messages are already human-written and clean, but
      // are deliberately not shown verbatim — keeps this mapping the single
      // place that decides what visitors see, independent of how any
      // Contract's internal error text might change later.
      return {
        state: "input_failed",
        message:
          "We couldn't gather enough information from that site to complete the analysis. Please check the website is publicly accessible and try again.",
      };
    case "configuration":
      return {
        state: "unavailable",
        message: "The Growth Audit isn't fully set up in this environment yet, so the analysis couldn't run.",
      };
    case "budget":
      return {
        state: "error",
        message: "This analysis reached a safety limit and stopped before completing. Please try again shortly.",
      };
    default:
      // Covers "unexpected" (e.g. an upstream provider outage) and any future
      // stage name not explicitly handled above — always the same calm,
      // generic message, never the raw stage name or reason.
      return { state: "error", message: GENERIC_FAILURE_MESSAGE };
  }
}

// Sprint 2 Stage 1: a compact one-line JSON summary to stdout for every run,
// success or failure. Redundant with the per-run log file on disk — this is
// the mitigation for Railway's persistent-storage status being unconfirmed;
// Railway's own deploy/log viewer is separate from the container's local
// filesystem, so a run's key facts survive here even if the JSON file itself
// is ever lost to a redeploy. No new infrastructure, no PII beyond what's
// already in the log file.
function logRunSummary(log: {
  runId: string;
  startedAt: string;
  finishedAt?: string;
  input: { rawInputValue: string; normalisedBusinessIdentifier: string };
  failure?: { stage: string; reason: string };
  llmUsage?: { totals: { estimatedCostUsd: number } };
}): void {
  console.log(
    "PV_RUN_SUMMARY " +
      JSON.stringify({
        runId: log.runId,
        url: log.input.rawInputValue,
        startedAt: log.startedAt,
        finishedAt: log.finishedAt,
        status: log.failure ? "failed" : "completed",
        failureStage: log.failure?.stage,
        estimatedCostUsd: log.llmUsage?.totals.estimatedCostUsd ?? null,
      })
  );
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
      message: "We're completing another Growth Audit right now. Please try again in a few minutes.",
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
    logRunSummary(log);

    if (log.failure) {
      const { state, message } = clientFacingFailureMessage(log.failure);
      write({ type: "error", state, message });
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
    // Truly unexpected — outside the pipeline's own try/catch (e.g. a bad
    // request body). Full detail goes to the server's own console (captured
    // by Railway's log viewer); the visitor never sees it.
    console.error("PV_UNEXPECTED_SERVER_ERROR", err instanceof Error ? err.stack ?? err.message : String(err));
    const body = { type: "error", state: "error", message: GENERIC_FAILURE_MESSAGE };
    if (!res.headersSent) {
      json(res, 500, body);
    } else {
      res.end(JSON.stringify(body) + "\n");
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
      console.log(
        "PV_EMAIL_SUMMARY " + JSON.stringify({ runId, email, status: "sent", sentAt: found.log.emailDelivery.sentAt })
      );
      json(res, 200, { state: "sent", message: "Done — your Growth Snapshot is on its way to your inbox." });
    } catch (err) {
      if (err instanceof EmailNotConfiguredError) {
        // Internal reason (e.g. "RESEND_API_KEY is not set") is exactly what
        // it says — logged, never shown. The visitor gets a calm generic
        // message; nothing about email providers or configuration.
        console.error("PV_EMAIL_NOT_CONFIGURED", err.message);
        json(res, 200, {
          state: "email_not_configured",
          message: "Email delivery isn't available right now, but your Snapshot is still shown above — nothing was lost.",
        });
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
      console.error("PV_EMAIL_SEND_FAILED", runId, err instanceof Error ? err.message : String(err));
      json(res, 502, {
        state: "send_failed",
        message: "We couldn't send the email right now. Your Snapshot is still shown above — nothing was lost.",
      });
    }
  } catch (err) {
    console.error("PV_UNEXPECTED_EMAIL_ERROR", err instanceof Error ? err.stack ?? err.message : String(err));
    json(res, 500, {
      state: "error",
      message: "Something went wrong on our end. Your Snapshot is still shown above — nothing was lost.",
    });
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
