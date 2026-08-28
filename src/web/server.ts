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
import {
  dailyBudgetCheck,
  deriveClientKey,
  guardConfigSummary,
  rateLimitCheck,
  recordSpend,
  UNAVAILABLE_MESSAGE,
} from "./guards.js";
import { corsConfigSummary, corsHeaders, preflightHeaders, resolveCors } from "./cors.js";

const WEB_DIR = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);

loadEnv();
let busy = false; // one run at a time — deliberate, not a missing feature

// Real pipeline stages -> visitor-facing Waiting Room milestones. These fire
// when the stage actually starts — no artificial timers, no fake narration.
//
// Observation-boundary pass: these labels are PUBLIC copy and were rewritten to
// match the free product's promise. The old Contract 4 label,
// "Reasoning about what's most limiting your growth", announced the judgement
// act to a visitor who is not buying judgement, and the old Contract 5 label
// promised a Snapshot that stage no longer writes.
//
// Every label still describes work that is genuinely happening — no stage was
// hidden and none was invented — but describes it as activity rather than as
// architecture. Contracts 2 and 4 still run and still produce the internal
// hypothesis; a visitor is simply not told that a constraint is being chosen,
// because the answer they are about to receive does not contain one.
const MILESTONES: [prefix: string, label: string][] = [
  ["Contract 0", "Confirming your website is reachable"],
  ["Site corpus", "Reading your published pages"],
  ["Contract 1", "Identifying your business from its own pages"],
  ["Contract 2", "Setting the context for the evidence review"],
  ["Contract 3", "Checking what your public pages show"],
  ["Contract 4", "Reviewing what the evidence does and does not settle"],
  ["Contract 5", "Finalising your Growth Snapshot"],
];

// Every JSON response goes through here, so attaching the browser-origin headers
// at this one point is what makes it structurally impossible to return a failure
// state the site's own page cannot read. A visitor must see the honest message,
// not an opaque CORS error.
function json(req: IncomingMessage, res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    ...corsHeaders(resolveCors(req.headers.origin)),
  });
  res.end(JSON.stringify(body));
}

// Sprint 2 Stage 1: no raw provider/infrastructure/exception text ever reaches
// the visitor. The full technical detail is still written to the per-run log
// file (log.failure, log.stages) and to stdout here (see logRunSummary) — this
// function only controls what the client is shown.
const GENERIC_FAILURE_MESSAGE =
  "We couldn't complete this Growth Snapshot just now. This is usually temporary — please try again shortly.";

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
      // One state, one message. The previous wording ("isn't fully set up in
      // this environment yet") described our configuration to a stranger who can
      // neither act on it nor needs to know it — and the pre-run guard now
      // refuses with UNAVAILABLE_MESSAGE for the same class of problem, so the
      // two paths said different things about the same state.
      return { state: "unavailable", message: UNAVAILABLE_MESSAGE };
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
/** Whether a stage completed, failed, or was never reached because the stage
 *  before it did not produce what it needs. "Never ran" and "ran and failed"
 *  are different facts and a log that blurs them is not worth reading. */
function stageState(reached: boolean, produced: boolean): "completed" | "failed" | "not reached" {
  if (!reached) return "not reached";
  return produced ? "completed" : "failed";
}

// ─── Stage 1.2: transport observability ──────────────────────────────────────
//
// The first live run completed, cost $0.2476, and the visitor saw a failure —
// and the server had no way to say which of those two facts described the
// delivery. It had no abort handler, no response error handler, and no way to
// distinguish "response finished" from "socket closed early".
//
// One compact event type answers that. Never carries Snapshot content, an email
// address, a provider detail or a key.
function logDelivery(event: string, runId: string | null, detail: Record<string, unknown> = {}): void {
  console.log("PV_DELIVERY " + JSON.stringify({ event, runId, ...detail }));
}

/** The run currently being computed, if any. Lets the recovery route answer
 *  "still working on it" instead of "never heard of it" — the difference
 *  between a client that waits and a client that gives up. */
let currentRunId: string | null = null;

/** End a response at most once.
 *
 *  Stage 1.2 hardening of a narrow risk the transport investigation found: the
 *  success path ends the response as its last statement, and the catch ends it
 *  again if headers were already sent. If the first end threw — which is
 *  exactly what a broken socket does — the catch would end a second time and
 *  turn a delivery failure into an unhandled one. */
function safeEnd(res: ServerResponse, body?: string): void {
  if (res.writableEnded || res.destroyed) return;
  try {
    if (body === undefined) res.end();
    else res.end(body);
  } catch (err) {
    logDelivery("end_failed", currentRunId, { code: (err as NodeJS.ErrnoException)?.code ?? "unknown" });
  }
}

// How often a heartbeat line is written while the pipeline is working.
//
// The measured silence between milestone writes is a median of 69s and up to
// 98s, because a milestone fires when a stage STARTS and Contract 4 then runs
// for over a minute. Any idle-based timeout between the browser and this
// process sees a dead connection for that whole window.
//
// 15 seconds keeps the connection demonstrably active with a wide margin under
// the 30-60s idle limits proxies commonly use, at a cost of roughly 22 bytes
// per beat — about eight beats across a typical run. It is a fixed constant,
// not configuration: there is no operational question a knob would answer here,
// and Railway's actual limit is not known to us anyway.
const HEARTBEAT_MS = 15_000;

function logRunSummary(log: {
  runId: string;
  startedAt: string;
  finishedAt?: string;
  input: { rawInputValue: string; normalisedBusinessIdentifier: string };
  failure?: { stage: string; reason: string };
  internalFailure?: { stage: string; reason: string };
  publicSnapshot?: unknown;
  reasoningResult?: unknown;
  growthSnapshot?: unknown;
  llmUsage?: { totals: { estimatedCostUsd: number } };
}): void {
  console.log(
    "PV_RUN_SUMMARY " +
      JSON.stringify({
        runId: log.runId,
        url: log.input.rawInputValue,
        startedAt: log.startedAt,
        finishedAt: log.finishedAt,
        // Stage 1.1: `status` reports the PUBLIC outcome, because that is what
        // the visitor experienced. A run that delivered a Snapshot and then lost
        // its internal reasoning is "completed" — reporting it as "failed" would
        // make every dashboard disagree with every visitor. The internal outcome
        // is carried alongside it rather than folded into it.
        status: log.failure ? "failed" : "completed",
        failureStage: log.failure?.stage,
        // Stage 1.2. `status` describes the COMPUTATION and always has. The
        // first live incident read "completed" against a browser that showed a
        // failure, and nothing in this line said which one it meant.
        //
        // This line is emitted before the terminal result is written, so at
        // this instant delivery genuinely has not been attempted. The resolved
        // outcome arrives separately as PV_DELIVERY response_finished or
        // closed_before_finish. Even response_finished only proves the bytes
        // left this process — no server can prove a browser rendered anything.
        publicDelivery: "not yet attempted — see PV_DELIVERY",
        // The three states Product Council asked to be distinguishable. Each is
        // three-valued: a stage that never ran is "not reached", which is a
        // different fact from one that ran and failed.
        publicSnapshot: log.publicSnapshot ? "completed" : "absent",
        internalReasoning: stageState(Boolean(log.publicSnapshot), Boolean(log.reasoningResult)),
        internalSnapshot: stageState(Boolean(log.reasoningResult), Boolean(log.growthSnapshot)),
        internalFailureStage: log.internalFailure?.stage,
        estimatedCostUsd: log.llmUsage?.totals.estimatedCostUsd ?? null,
      })
  );
}

// Rate-limit identity. Railway's public-networking contract supplies the
// client's remote address in X-Real-IP; caller-controlled X-Forwarded-For is
// deliberately not consulted. The derivation lives in guards.ts so it can be
// exercised without booting a server; this passes the raw inputs through and
// forwards the one-per-process source diagnostic to stdout.
function clientIp(req: IncomingMessage): string {
  return deriveClientKey(req.headers["x-real-ip"], req.socket.remoteAddress, (line) => console.log(line));
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
    json(req, res, 429, { type: "error", state: "rate_limited", message: rate.message });
    return;
  }
  // Distinct machine-readable outcomes: "daily_capacity" means the configured
  // budget is spent, "unavailable" means the budget itself could not be read and
  // the run is refused before any provider call. Both are 503; only the state
  // tells them apart.
  const budget = dailyBudgetCheck();
  if (!budget.allowed) {
    if (budget.state === "unavailable") {
      console.error("PV_GUARD_REFUSED " + guardConfigSummary().summary);
    }
    json(req, res, 503, { type: "error", state: budget.state, message: budget.message });
    return;
  }
  if (busy) {
    json(req, res, 503, {
      type: "error",
      state: "busy",
      message: "We're completing another Growth Snapshot right now. Please try again in a few minutes.",
    });
    return;
  }
  busy = true;
  try {
    const url = String((await readBody(req)).url ?? "").trim();
    if (!url) {
      json(req, res, 400, { type: "error", state: "input_failed", message: "Please enter a business website URL." });
      return;
    }

    // NDJSON stream: milestone events as the pipeline actually progresses,
    // then one final result/error line.
    // Headers must be complete before the first byte of the stream — once
    // writeHead runs they cannot be amended, so the browser-origin headers go on
    // here rather than at the end.
    res.writeHead(200, {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
      ...corsHeaders(resolveCors(req.headers.origin)),
    });

    // Nothing is written to a response that has already ended or been
    // destroyed. The heartbeat timer and the pipeline both outlive a browser
    // that walks away, and neither may write into a dead socket.
    const write = (obj: unknown): void => {
      if (res.writableEnded || res.destroyed) return;
      res.write(JSON.stringify(obj) + "\n");
    };

    // Transport observability. Registered before any work so an abort during
    // the run is seen. `runId` is filled in a moment later by run_started.
    let runId: string | null = null;
    req.on("aborted", () => logDelivery("request_aborted", runId));
    res.on("error", (err: NodeJS.ErrnoException) =>
      logDelivery("response_error", runId, { code: err?.code ?? "unknown" })
    );
    res.on("close", () => {
      // finish = the response was fully written and flushed to the OS.
      // close without finish = the peer went away mid-stream, which is the
      // shape of the incident this stage exists to survive.
      if (!res.writableFinished) logDelivery("closed_before_finish", runId);
    });
    res.on("finish", () => logDelivery("response_finished", runId));

    // Heartbeat: keeps the connection demonstrably active through the long
    // silent windows. Carries a type and nothing else — no result, no
    // reasoning, no progress claim, no provider detail. `unref` so a stray
    // timer can never hold the process open.
    const heartbeat = setInterval(() => {
      if (res.writableEnded || res.destroyed) {
        clearInterval(heartbeat);
        return;
      }
      write({ type: "heartbeat" });
    }, HEARTBEAT_MS);
    heartbeat.unref?.();

    const seen = new Set<string>();
    let log: Awaited<ReturnType<typeof runPipeline>>["log"];
    try {
      ({ log } = await runPipeline(
        url,
        (event) => {
          if (!event.endsWith("— started")) return;
          const m = MILESTONES.find(([prefix]) => event.startsWith(prefix));
          if (m && !seen.has(m[0])) {
            seen.add(m[0]);
            write({ type: "milestone", label: m[1] });
          }
        },
        // The canonical id, announced before any fetch or provider call. A
        // client that has this can collect the result later even if this
        // connection dies one second from now.
        (id) => {
          runId = id;
          currentRunId = id;
          write({ type: "run_started", runId: id });
        }
      ));
    } finally {
      clearInterval(heartbeat);
      currentRunId = null;
    }

    if (log.llmUsage && log.llmUsage.totals.estimatedCostUsd > 0) {
      // Bookkeeping runs after the Snapshot already exists, so a ledger failure
      // is logged for the operator and never allowed to destroy a finished
      // result. An unrecorded run leaves the ledger unreadable or stale, which
      // the next request's budget check will refuse on — fail-closed, not silent.
      const spend = recordSpend(log.llmUsage.totals.estimatedCostUsd);
      if (!spend.recorded) console.error("PV_SPEND_NOT_RECORDED " + spend.reason);
    }

    // Stage 1.1. The visitor is about to receive a complete Growth Snapshot, so
    // nothing on their side signals that anything went wrong — which is exactly
    // why this has to be loud on ours. Full reason included: this goes to the
    // server's own log, never to a response body.
    if (log.internalFailure) {
      console.error(
        "PV_INTERNAL_REASONING_FAILED " +
          JSON.stringify({
            runId: log.runId,
            stage: log.internalFailure.stage,
            reason: log.internalFailure.reason,
            publicSnapshotDelivered: log.publicSnapshot !== undefined,
            reasoningResultPresent: log.reasoningResult !== undefined,
            internalSnapshotPresent: log.growthSnapshot !== undefined,
          })
      );
    }
    logRunSummary(log);

    // Stage 1.1: the terminal branch keys on WHETHER THE PUBLIC PRODUCT EXISTS,
    // not on whether anything in the run went wrong. Those became different
    // questions the moment the public Snapshot stopped depending on the
    // reasoning stages, and this line is where the difference is honoured:
    // a completed observation is delivered even if Contract 4 or 5 later failed.
    if (!log.publicSnapshot) {
      const { state, message } = clientFacingFailureMessage(
        log.failure ?? { stage: "unexpected", reason: "the run produced no public Snapshot" }
      );
      write({ type: "error", state, message });
    } else {
      // THE PUBLIC WIRE CONTRACT.
      //
      // `publicSnapshot` carries the observation projection and nothing else.
      // `log.growthSnapshot` — the internal Contract 5 output, which does name
      // and rank a constraint — is deliberately NOT written here. The judgement
      // fields are absent from the payload, not hidden by the UI: a frontend
      // cannot render what it was never sent, and a future frontend edit cannot
      // reintroduce the leak.
      //
      // The key was renamed from `snapshot` on purpose. A client built against
      // the old contract now fails its shape check and shows an honest error,
      // rather than silently rendering blank cards from missing fields.
      write({
        type: "result",
        state: "snapshot",
        mockMode: (process.env.DRDS_LLM_PROVIDER || "anthropic").toLowerCase() === "mock",
        runId: log.runId,
        businessName: log.cip?.businessName,
        publicSnapshot: log.publicSnapshot,
      });
    }
    safeEnd(res);
  } catch (err) {
    // Truly unexpected — outside the pipeline's own try/catch (e.g. a bad
    // request body). Full detail goes to the server's own console (captured
    // by Railway's log viewer); the visitor never sees it.
    console.error("PV_UNEXPECTED_SERVER_ERROR", err instanceof Error ? err.stack ?? err.message : String(err));
    const body = { type: "error", state: "error", message: GENERIC_FAILURE_MESSAGE };
    if (!res.headersSent) {
      json(req, res, 500, body);
    } else {
      // safeEnd, not res.end: if the success path's end already ran or the
      // socket is gone, ending again would raise a second error inside the
      // handler for the first one.
      safeEnd(res, JSON.stringify(body) + "\n");
    }
  } finally {
    busy = false;
  }
}

// ─── Stage 1.2: recovery by runId ────────────────────────────────────────────
//
//   Retry delivery, never silently retry paid computation.
//
// A Snapshot that cost real money and completed on the server must not be lost
// because a connection broke on the way to the browser. This route hands back
// an ALREADY-STORED public projection and does nothing else.
//
// What it structurally cannot do:
//   · run the pipeline — runPipeline is never called from here;
//   · call a provider — no llm module is reachable on this path;
//   · spend anything — no budget is consulted because none is consumed;
//   · leak judgement — it reads `publicSnapshot` and never `growthSnapshot`,
//     `reasoningResult` or `internalFailure`.
//
// It deliberately does NOT consume the paid 4-per-hour allowance: a broken
// connection must not cost the visitor the retries they need to collect what
// they already paid for. It gets its own, more generous bucket instead.
const RECOVERY_LIMIT_PER_HOUR = 60;

async function handleRecover(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const rate = rateLimitCheck(clientIp(req), { bucket: "recover", runsPerHour: RECOVERY_LIMIT_PER_HOUR });
  if (!rate.allowed) {
    json(req, res, 429, { state: "rate_limited", message: "Too many recovery attempts. Please try again shortly." });
    return;
  }
  try {
    const runId = String((await readBody(req)).runId ?? "");

    // The run this process is computing right now. Answering "pending" rather
    // than "not found" is what lets a client wait instead of giving up on work
    // that is still being paid for.
    if (runId && runId === currentRunId) {
      logDelivery("recovery_pending", runId);
      json(req, res, 202, {
        state: "pending",
        message: "Your Growth Snapshot is still being prepared. Please wait a moment.",
      });
      return;
    }

    const found = findRunLogByRunId(runId);
    if (!found) {
      logDelivery("recovery_not_found", runId || null);
      json(req, res, 404, {
        state: "not_found",
        message: "We couldn't find that Growth Snapshot. It may have expired.",
      });
      return;
    }
    if (!found.log.publicSnapshot) {
      // The run exists but never produced a public product — it failed before
      // the observation layer, or predates the projection entirely. Reported
      // honestly; there is deliberately no fallback to the internal Snapshot.
      logDelivery("recovery_incomplete", runId);
      json(req, res, 409, {
        state: "incomplete",
        message: "That Growth Snapshot did not complete. Nothing was stored to show you.",
      });
      return;
    }

    logDelivery("recovery_served", runId);
    json(req, res, 200, {
      state: "recovered",
      runId: found.log.runId,
      businessName: found.log.cip?.businessName,
      mockMode: (process.env.DRDS_LLM_PROVIDER || "anthropic").toLowerCase() === "mock",
      // The identical public projection the live stream would have carried.
      publicSnapshot: found.log.publicSnapshot,
    });
  } catch (err) {
    console.error("PV_UNEXPECTED_RECOVERY_ERROR", err instanceof Error ? err.stack ?? err.message : String(err));
    json(req, res, 500, { state: "error", message: GENERIC_FAILURE_MESSAGE });
  }
}

async function handleEmail(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const body = await readBody(req);
    const runId = String(body.runId ?? "");
    const email = String(body.email ?? "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      json(req, res, 400, { state: "invalid_email", message: "Please enter a valid email address." });
      return;
    }
    const found = findRunLogByRunId(runId);
    // publicSnapshot, never growthSnapshot: the email is a public surface and
    // may only ever carry the observation projection. A run log written before
    // the observation-boundary pass has no publicSnapshot, so it is treated as
    // not found rather than emailed from the internal object.
    if (!found || !found.log.publicSnapshot) {
      json(req, res, 404, { state: "not_found", message: "We couldn't find that Snapshot. Please run the analysis again." });
      return;
    }
    if (found.log.emailDelivery?.status === "sent") {
      json(req, res, 200, { state: "already_sent", message: "This Snapshot has already been emailed." });
      return;
    }
    try {
      const sent = await sendSnapshotEmail(
        email,
        found.log.cip?.businessName ?? found.log.input.normalisedBusinessIdentifier,
        found.log.publicSnapshot
      );
      found.log.emailDelivery = { to: email, sentAt: new Date().toISOString(), provider: sent.provider, status: "sent" };
      updateRunLog(found.file, found.log);
      console.log(
        "PV_EMAIL_SUMMARY " + JSON.stringify({ runId, email, status: "sent", sentAt: found.log.emailDelivery.sentAt })
      );
      json(req, res, 200, { state: "sent", message: "Done — your Growth Snapshot is on its way to your inbox." });
    } catch (err) {
      if (err instanceof EmailNotConfiguredError) {
        // Internal reason (e.g. "RESEND_API_KEY is not set") is exactly what
        // it says — logged, never shown. The visitor gets a calm generic
        // message; nothing about email providers or configuration.
        console.error("PV_EMAIL_NOT_CONFIGURED", err.message);
        json(req, res, 200, {
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
      json(req, res, 502, {
        state: "send_failed",
        message: "We couldn't send the email right now. Your Snapshot is still shown above — nothing was lost.",
      });
    }
  } catch (err) {
    console.error("PV_UNEXPECTED_EMAIL_ERROR", err instanceof Error ? err.stack ?? err.message : String(err));
    json(req, res, 500, {
      state: "error",
      message: "Something went wrong on our end. Your Snapshot is still shown above — nothing was lost.",
    });
  }
}

// Every browser-reachable API path. Membership here is what puts a route behind
// the exact-origin CORS allowlist and gives it a readable preflight — so a new
// route must be added, or the site's own page could not read its responses.
// Still an explicit list; still no wildcard anywhere.
const API_ROUTES = new Set(["/api/snapshot", "/api/recover", "/api/email"]);

// Exported so an offline test can bind it on an ephemeral port (PORT=0),
// exercise the real NDJSON route end to end and close it again. Nothing in
// production reads this export; the listen call below is unchanged.
export const server = createServer(async (req, res) => {
  if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(readFileSync(join(WEB_DIR, "index.html"), "utf8"));
    return;
  }

  // Browser origin boundary, resolved once and applied before any handler runs.
  // Requests with no Origin header are untouched: CLI use, direct API
  // inspection and existing tooling keep working exactly as before.
  if (req.url && API_ROUTES.has(req.url)) {
    const cors = resolveCors(req.headers.origin);

    // Preflight. Answered here, ahead of rate limiting, budget accounting, body
    // parsing and the pipeline — a preflight is a question about permission, so
    // it consumes no allowance, records no spend and starts no work.
    if (req.method === "OPTIONS") {
      if (cors.kind === "allowed") {
        res.writeHead(204, preflightHeaders(cors));
      } else {
        // No Access-Control-Allow-Origin, and nothing about what IS allowed.
        res.writeHead(403, { "Content-Type": "text/plain", ...corsHeaders(cors) });
      }
      res.end();
      return;
    }

    // A browser origin that is not allowlisted is refused before anything
    // costly happens. Deliberately terse: the response reveals no configuration.
    if (cors.kind === "denied") {
      res.writeHead(403, { "Content-Type": "text/plain", ...corsHeaders(cors) });
      res.end("Forbidden");
      return;
    }
  }

  if (req.method === "POST" && req.url === "/api/snapshot") return handleSnapshot(req, res);
  if (req.method === "POST" && req.url === "/api/recover") return handleRecover(req, res);
  if (req.method === "POST" && req.url === "/api/email") return handleEmail(req, res);
  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not found");
});

server.listen(PORT, () => {
  const provider = (process.env.DRDS_LLM_PROVIDER || "anthropic").toLowerCase();
  console.log(`DRDS prototype: http://localhost:${PORT}  (LLM provider: ${provider}, email: ${process.env.RESEND_API_KEY ? "configured" : "NOT configured"})`);
  // Surface guard configuration at boot, so a misconfigured deploy is visible in
  // the log viewer immediately rather than at the moment a visitor is refused.
  const guards = guardConfigSummary();
  (guards.ok ? console.log : console.error)("PV_GUARD_CONFIG " + guards.summary);
  console.log("PV_CORS_CONFIG " + corsConfigSummary());
});
