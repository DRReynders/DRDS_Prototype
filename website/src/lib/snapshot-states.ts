// The visitor-facing failure contract for the Growth Snapshot.
//
// The backend already decides what a stranger is allowed to see and returns a
// machine-readable `state` alongside a human message. This module is the
// website's side of that contract: it maps a state to copy the site controls,
// and — critically — it NEVER interpolates anything the backend sent into what
// it renders beyond the recognised states below.
//
// Rules this file exists to enforce:
//   - no provider, vendor, model or host is ever named;
//   - no cost, budget, cap or environment detail is ever named;
//   - no stack trace, exception text or API internal reaches the page;
//   - no invented progress percentage and no invented ETA.

export type SnapshotState =
  | "input_failed"
  | "rate_limited"
  | "daily_capacity"
  | "unavailable"
  | "busy"
  | "backend_unreachable"
  | "error";

export interface SnapshotFailure {
  state: SnapshotState;
  /** What the visitor reads. */
  message: string;
  /** Whether to offer the human path. True for states the visitor cannot act on. */
  offerHumanPath: boolean;
}

// Ratified by Product Council. Used verbatim for a service that refused the run
// because of its own configuration or accounting state.
const UNAVAILABLE_MESSAGE = "The Growth Snapshot is temporarily unavailable. Please try again later.";

const GENERIC_MESSAGE =
  "We couldn't complete this Growth Snapshot just now. This is usually temporary — please try again shortly.";

const COPY: Record<SnapshotState, { message: string; offerHumanPath: boolean }> = {
  // The visitor can fix this one themselves, so it does not divert them.
  input_failed: {
    message: "That doesn't look like a business website address. Please check it and try again.",
    offerHumanPath: false,
  },
  rate_limited: {
    message: "You've reached the limit for instant Growth Snapshots from this connection.",
    offerHumanPath: true,
  },
  daily_capacity: {
    message:
      "We've reached today's capacity for Growth Snapshots. Please try again tomorrow — this isn't a reflection of your business, simply a temporary capacity limit.",
    offerHumanPath: true,
  },
  unavailable: { message: UNAVAILABLE_MESSAGE, offerHumanPath: true },
  busy: {
    message: "We're completing another Growth Snapshot right now. Please try again in a few minutes.",
    offerHumanPath: true,
  },
  // The browser could not reach the Snapshot service at all. Deliberately
  // indistinguishable to the visitor from any other outage: it is not their
  // problem which part failed.
  backend_unreachable: { message: UNAVAILABLE_MESSAGE, offerHumanPath: true },
  error: { message: GENERIC_MESSAGE, offerHumanPath: true },
};

const KNOWN_STATES = new Set<string>(Object.keys(COPY));

/**
 * Turn whatever the backend returned into a failure this site is willing to
 * show. An unrecognised state collapses to the generic message rather than
 * being echoed — an unknown state is exactly the case where echoing risks
 * leaking something internal.
 *
 * The backend's own message is used ONLY for states where it is already
 * reviewed, visitor-safe copy that carries real detail the site cannot compute
 * (the rate-limit retry window). Everything else uses the site's own copy.
 */
export function toFailure(state: unknown, backendMessage?: unknown): SnapshotFailure {
  const key = typeof state === "string" && KNOWN_STATES.has(state) ? (state as SnapshotState) : "error";
  const copy = COPY[key];

  if (key === "rate_limited" && typeof backendMessage === "string" && backendMessage.trim()) {
    // The backend computes a real retry window from its own rolling counter.
    // That is a genuine fact the site cannot derive, and it is already
    // visitor-facing copy — so it is passed through, bounded in length.
    return { state: key, message: backendMessage.trim().slice(0, 300), offerHumanPath: copy.offerHumanPath };
  }

  return { state: key, message: copy.message, offerHumanPath: copy.offerHumanPath };
}

/** Milestone labels are supplied by the backend as it genuinely reaches each
 *  stage. The site renders them as received and never invents one, never
 *  animates a fake percentage, and never predicts what comes next. */
export function sanitiseMilestone(label: unknown): string | null {
  if (typeof label !== "string") return null;
  const trimmed = label.trim();
  if (!trimmed || trimmed.length > 120) return null;
  return trimmed;
}
