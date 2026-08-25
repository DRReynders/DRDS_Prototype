// Measurement architecture, not measurement.
//
// NOTHING IS TRANSMITTED ANYWHERE. No analytics provider is installed, no script
// is loaded, no network request is made. This module exists so that the funnel's
// event vocabulary is decided once, in code, before a vendor is chosen — and so
// that whichever vendor is eventually chosen inherits a contract rather than
// setting one.
//
// The standing rules below are the point of the file. They are easy to honour
// now and very hard to retrofit after a vendor is wired in.

/** The approved funnel, as events. */
export const SNAPSHOT_INTENT = "snapshot_intent";
export const SNAPSHOT_STARTED = "snapshot_started";
export const SNAPSHOT_COMPLETED = "snapshot_completed";
export const SNAPSHOT_FAILED = "snapshot_failed";
export const REPORT_CTA_CLICKED = "report_cta_clicked";
export const START_BEGUN = "start_begun";
export const START_SUBMITTED = "start_submitted";
export const BLUEPRINT_INTEREST = "blueprint_interest";

export type FunnelEvent =
  | typeof SNAPSHOT_INTENT
  | typeof SNAPSHOT_STARTED
  | typeof SNAPSHOT_COMPLETED
  | typeof SNAPSHOT_FAILED
  | typeof REPORT_CTA_CLICKED
  | typeof START_BEGUN
  | typeof START_SUBMITTED
  | typeof BLUEPRINT_INTEREST;

/** Only enumerated values and coarse buckets. Never free text, never an
 *  identifier that could single out a visitor or name a third-party business. */
export type EventProperties = Record<string, string | number | boolean>;

// ─────────────────────────────────────────────────────────────
// MUST NEVER BE CAPTURED — the list is the contract.
//
//   · the submitted business URL or domain. It identifies a third-party
//     business that never agreed to appear in DRDS's analytics.
//   · any Snapshot copy: the constraint, the evidence, the confidence line.
//   · anything typed on /start/ — name, email, phone, business context.
//   · raw backend failure reasons, which can carry fetch or exception text.
//   · precise per-run timings, which begin to identify individual visitors.
//     Use `durationBucket` instead.
// ─────────────────────────────────────────────────────────────

/** Coarse buckets, so a completed run can be measured without being timed. */
export function durationBucket(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "unknown";
  if (ms < 60_000) return "<60s";
  if (ms < 120_000) return "60-120s";
  if (ms < 180_000) return "120-180s";
  return ">180s";
}

/**
 * The single seam a future analytics provider plugs into.
 *
 * Today it is deliberately inert — it does nothing at all. When Product Council
 * chooses a vendor, exactly one function body changes, and every call site
 * already passes vendor-neutral names and safe properties.
 */
export function track(_event: FunnelEvent, _properties: EventProperties = {}): void {
  // Intentionally empty. No provider is installed and nothing is sent.
}
