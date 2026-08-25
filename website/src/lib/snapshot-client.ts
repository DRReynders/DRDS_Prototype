// The website's only knowledge of the Growth Snapshot backend.
//
// Provider-neutral by construction: this module knows about HTTP, an NDJSON
// stream, milestones and a result shape. It knows nothing about which model,
// vendor or host produced that result, and nothing here should ever teach it.
// If the diagnostic runtime is replaced, this file's contract is what the
// replacement must honour — not the other way round.
//
// It also holds no judgement. The Snapshot's findings are produced by the
// backend and rendered as received; the website never re-derives, re-ranks or
// re-words a constraint. That boundary is the product boundary.

import { SNAPSHOT_API_ORIGIN } from "./config";
import { sanitiseMilestone, toFailure, type SnapshotFailure } from "./snapshot-states";

/** The Snapshot result shape, mirroring the backend's GrowthSnapshot contract.
 *  Additive fields are tolerated; the site reads named fields only. */
export interface GrowthSnapshot {
  primaryConstraint: string;
  whatIsGoingWell: string;
  whyWeThinkThis: string;
  howFixingItWillHelp: string;
  nextSteps: string;
  confidencePlainLanguage: string;
  verificationRequired?: boolean;
}

export interface SnapshotResult {
  /** Stable per-run identifier issued by the backend. Preserved because it is
   *  the handle a durable result URL would later be built on. */
  runId: string;
  businessName?: string;
  snapshot: GrowthSnapshot;
  mockMode?: boolean;
}

export interface SnapshotHandlers {
  onMilestone(label: string): void;
  onResult(result: SnapshotResult): void;
  onFailure(failure: SnapshotFailure): void;
}

const SNAPSHOT_PATH = "/api/snapshot";

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

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  // Collected rather than assigned to a closed-over `let`: the stream's terminal
  // line is written from inside `consume`, and a plain variable would be
  // narrowed to its initial value at the read site below.
  const terminalEvents: Record<string, unknown>[] = [];

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
    if (event.type === "milestone") {
      const label = sanitiseMilestone(event.label);
      if (label) handlers.onMilestone(label);
      return;
    }
    terminalEvents.push(event);
  };

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
    // The connection dropped mid-run. Honest: we do not know whether the run
    // finished, so nothing is claimed about it.
    handlers.onFailure(toFailure("backend_unreachable"));
    return;
  }

  // The last terminal line wins; in practice the backend writes exactly one.
  const event = terminalEvents.at(-1);
  if (!event) {
    // The stream ended without a result or an error. We do not know whether the
    // run completed, so nothing is claimed about it.
    handlers.onFailure(toFailure("error"));
    return;
  }
  if (event.type === "error") {
    handlers.onFailure(toFailure(event.state, event.message));
    return;
  }
  if (event.type === "result" && isRecord(event.snapshot) && typeof event.runId === "string") {
    handlers.onResult({
      runId: event.runId,
      businessName: typeof event.businessName === "string" ? event.businessName : undefined,
      snapshot: event.snapshot as unknown as GrowthSnapshot,
      mockMode: event.mockMode === true,
    });
    return;
  }
  handlers.onFailure(toFailure("error"));
}
