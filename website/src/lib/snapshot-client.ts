// The website's only knowledge of the Growth Snapshot backend.
//
// Provider-neutral by construction: this module knows about HTTP, an NDJSON
// stream, milestones and a result shape. It knows nothing about which model,
// vendor or host produced that result, and nothing here should ever teach it.
// If the diagnostic runtime is replaced, this file's contract is what the
// replacement must honour — not the other way round.
//
// It also holds no judgement — and since the observation-boundary pass it is
// not sent any. The backend's public contract carries observations, strengths,
// open questions, evidence confidence and a receipt. It does not carry a
// constraint, a ranking, or a claim about what fixing something would do.
// The site therefore cannot render one, whatever its copy says. That boundary
// is the product boundary, and it lives in the payload rather than the wording.

import { SNAPSHOT_API_ORIGIN } from "./config.js";
import { sanitiseMilestone, toFailure, type SnapshotFailure } from "./snapshot-states.js";

/** The PUBLIC Snapshot contract, mirroring the backend's PublicSnapshot.
 *
 *  This is an observation contract. There is deliberately no constraint here,
 *  no ranking, no "what changes if you fix it", and no confidence in a selected
 *  problem — the backend does not send those fields, so this site could not
 *  render them even if a future edit tried to.
 *
 *  Additive fields are tolerated; the site reads named fields only. */
export interface PublicSignal {
  /** What the published pages showed. */
  statement: string;
  /** The counted detail behind it — rendered under "Why we think this". */
  proof: string;
  /** The page(s) it was read from. */
  source: string;
}

export interface PublicUnsettled {
  question: string;
  reason: string;
}

export interface PublicReceipt {
  pagesInspected: string[];
  pagesInspectedCount: number;
  signalsChecked: number;
  signalsSettled: number;
  notInspected: string[];
  limitations: string[];
}

export interface PublicSnapshot {
  businessRead: string;
  whatWeCanSee: PublicSignal[];
  whatIsWorking: PublicSignal[];
  whatWeCouldNotSettle: PublicUnsettled[];
  /** Confidence in the EVIDENCE, never in a constraint. */
  evidenceConfidence: string;
  evidenceReceipt: PublicReceipt;
  boundaryNote: string;
}

export interface SnapshotResult {
  /** Stable per-run identifier issued by the backend. Preserved because it is
   *  the handle a durable result URL would later be built on. */
  runId: string;
  businessName?: string;
  snapshot: PublicSnapshot;
  mockMode?: boolean;
}

export interface SnapshotHandlers {
  onMilestone(label: string): void;
  onResult(result: SnapshotResult): void;
  onFailure(failure: SnapshotFailure): void;
  /** The canonical run id, as soon as the server announces it. The page keeps
   *  it so a later broken connection can collect the finished Snapshot. */
  onRunId?(runId: string): void;
  /** The connection dropped and we are asking for the completed run instead.
   *  Never fired for a new analysis — this is retrieval, not computation. */
  onRecovering?(attempt: number, attempts: number): void;
}

const SNAPSHOT_PATH = "/api/snapshot";
const RECOVER_PATH = "/api/recover";

// Stage 1.2 — bounded recovery schedule.
//
//   Retry delivery, never silently retry paid computation.
//
// If the stream breaks the run usually keeps going server-side, so recovery has
// to outlast the rest of the pipeline: measured runs take 105-152s in total and
// a break at the Contract 4 milestone leaves well over a minute to wait. These
// seven delays span about 172 seconds, then stop. Fixed and deterministic —
// no jitter, no exponential growth, no unbounded polling.
const RECOVERY_DELAYS_MS = [2000, 5000, 10000, 20000, 30000, 45000, 60000] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Run a Growth Snapshot and report progress as it genuinely happens.
 *
 * The backend streams NDJSON: zero or more `{type:"milestone"}` lines as each
 * pipeline stage actually starts, then exactly one terminal `{type:"result"}`
 * or `{type:"error"}` line. There are no timers and no predicted stages — a
 * milestone appears because work reached that point.
 */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      resolve();
    }, { once: true });
  });
}

/**
 * Collect an already-completed Snapshot for a run whose delivery failed.
 *
 * THIS NEVER STARTS AN ANALYSIS. It only ever calls /api/recover, which reads a
 * stored run and returns its public projection. `/api/snapshot` is not reachable
 * from here, so no path through this function can spend money.
 *
 * Exported so a test can exercise the retry schedule directly.
 */
export async function recoverRun(
  runId: string,
  handlers: SnapshotHandlers,
  signal?: AbortSignal
): Promise<void> {
  for (let attempt = 0; attempt < RECOVERY_DELAYS_MS.length; attempt++) {
    if (signal?.aborted) return;
    handlers.onRecovering?.(attempt + 1, RECOVERY_DELAYS_MS.length);
    await sleep(RECOVERY_DELAYS_MS[attempt], signal);
    if (signal?.aborted) return;

    let response: Response;
    try {
      response = await fetch(`${SNAPSHOT_API_ORIGIN}${RECOVER_PATH}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId }),
        signal,
      });
    } catch {
      continue; // still unreachable — the schedule decides when to stop
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      continue;
    }
    if (!isRecord(body)) continue;

    // 202 pending: the run is still being computed. Keep waiting — this is the
    // case that makes patience correct rather than wasteful.
    if (body.state === "pending") continue;

    if (
      response.ok &&
      body.state === "recovered" &&
      isRecord(body.publicSnapshot) &&
      typeof body.runId === "string"
    ) {
      handlers.onResult({
        runId: body.runId,
        businessName: typeof body.businessName === "string" ? body.businessName : undefined,
        snapshot: body.publicSnapshot as unknown as PublicSnapshot,
        mockMode: body.mockMode === true,
      });
      return;
    }

    // A definite answer that is not a Snapshot — the run is not there, or it
    // never completed. Retrying cannot change either, so stop honestly.
    if (body.state === "not_found" || body.state === "incomplete") {
      handlers.onFailure(toFailure("unrecoverable"));
      return;
    }
  }

  // The schedule ran out. Bounded, as designed: no further attempts, and
  // still no second analysis.
  handlers.onFailure(toFailure("recovery_exhausted"));
}

export async function runSnapshot(url: string, handlers: SnapshotHandlers, signal?: AbortSignal): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${SNAPSHOT_API_ORIGIN}${SNAPSHOT_PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
      signal,
    });
  } catch {
    // Network-level failure: DNS, TLS, offline, or a cross-origin request the
    // browser refused. The visitor is told the service is unavailable — which
    // is true — and never which layer failed.
    handlers.onFailure(toFailure("backend_unreachable"));
    return;
  }

  // A guard refused before the run started; the body is a single JSON object.
  if (!response.ok) {
    let state: unknown = "error";
    let message: unknown;
    try {
      const body = (await response.json()) as unknown;
      if (isRecord(body)) {
        state = body.state;
        message = body.message;
      }
    } catch {
      /* unreadable body — the generic mapping below still applies */
    }
    handlers.onFailure(toFailure(state, message));
    return;
  }

  if (!response.body) {
    handlers.onFailure(toFailure("error"));
    return;
  }

  // Learned from the run_started event, before any long processing. Without it
  // a broken connection is unrecoverable, because there is nothing to ask for.
  let runId: string | null = null;

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  // Collected rather than assigned to a closed-over `let`: the stream's terminal
  // line is written from inside `consume`, and a plain variable would be
  // narrowed to its initial value at the read site below.
  const terminalEvents: Record<string, unknown>[] = [];

  // Explicit dispatch by event type.
  //
  // This used to be "milestone, or else terminal", which meant ANY unrecognised
  // line silently became the run's terminal answer. That made the stream
  // unextendable: adding a heartbeat would have replaced every successful
  // result with a generic failure. Unknown types are now ignored — the
  // fail-safe direction, because a line we do not understand is not a result
  // and must never be treated as one.
  const consume = (line: string): void => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let event: unknown;
    try {
      event = JSON.parse(trimmed);
    } catch {
      return; // a partial or malformed line is skipped, never surfaced
    }
    if (!isRecord(event)) return;

    switch (event.type) {
      case "run_started":
        // Metadata only. Recorded so a broken connection is recoverable.
        if (typeof event.runId === "string" && event.runId) {
          runId = event.runId;
          handlers.onRunId?.(event.runId);
        }
        return;
      case "milestone": {
        const label = sanitiseMilestone(event.label);
        if (label) handlers.onMilestone(label);
        return;
      }
      case "heartbeat":
        // Transport keepalive. Deliberately invisible: it is not progress and
        // must never be rendered as any.
        return;
      case "result":
      case "error":
        terminalEvents.push(event);
        return;
      default:
        return; // unknown type — ignored, never terminal
    }
  };

  // Stage 1.2 — TERMINAL-RESULT PRESERVATION.
  //
  // This catch used to `return` a failure, which threw away a fully received,
  // fully parsed Snapshot if the stream errored on the way to closing. That is
  // what lost the first live run: the product was in this array, and the client
  // reported "temporarily unavailable" over the top of it.
  //
  // Now a transport error is recorded and execution falls through to the
  // terminal-event evaluation below. A valid result always wins. If there is no
  // result, the flag below decides between "the connection broke" and "the
  // stream just ended with nothing in it" — still two different truths.
  let streamBroke = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        consume(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
      }
    }
    consume(buffer);
  } catch {
    streamBroke = true;
  }

  // The last terminal line wins; in practice the backend writes exactly one.
  const event = terminalEvents.at(-1);
  if (!event) {
    // Nothing terminal arrived. If the connection broke, the run may still be
    // completing on the server — so ask for that same run rather than starting
    // a second paid one. Recovery is retrieval; it never re-analyses.
    if (streamBroke && runId) {
      await recoverRun(runId, handlers, signal);
      return;
    }
    // The stream ended cleanly with no result, or broke before the server had
    // even announced a run id. We do not know whether anything completed, so
    // nothing is claimed about it.
    handlers.onFailure(toFailure(streamBroke ? "backend_unreachable" : "error"));
    return;
  }
  if (event.type === "error") {
    handlers.onFailure(toFailure(event.state, event.message));
    return;
  }
  // `publicSnapshot`, not `snapshot`. The backend renamed the key when the
  // public contract changed shape, precisely so a client built against the old
  // one fails this check and shows an honest error rather than quietly
  // rendering empty cards from fields that no longer exist.
  if (event.type === "result" && isRecord(event.publicSnapshot) && typeof event.runId === "string") {
    handlers.onResult({
      runId: event.runId,
      businessName: typeof event.businessName === "string" ? event.businessName : undefined,
      snapshot: event.publicSnapshot as unknown as PublicSnapshot,
      mockMode: event.mockMode === true,
    });
    return;
  }
  handlers.onFailure(toFailure("error"));
}
