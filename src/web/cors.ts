// Browser origin boundary for the public API.
//
// The Snapshot service is deliberately a separate deployment from the Website V2
// static site, so the site's browser client is cross-origin by design. This
// module is the whole of that boundary: an explicit allowlist, exact-origin
// matching, and no wildcard.
//
// What it deliberately is NOT:
//   - a wildcard. `*` is never emitted and never accepted as configuration.
//   - a credentials boundary. The API uses no cookies and no session, so
//     Access-Control-Allow-Credentials is not sent and must not be added
//     without a real product requirement.
//   - a security control for non-browser callers. CORS is enforced by browsers,
//     not by servers; a direct client can always ignore it. The real spend
//     controls remain the rate limit and the daily budget in guards.ts.
//
// It sits above the provider layer and knows nothing about which model, vendor
// or runtime produces a Snapshot.

/** Requests carrying no Origin header are not browser cross-origin requests.
 *  They keep the service's original behaviour untouched — this is what CLI use,
 *  direct API inspection and existing engineering tooling rely on. */
export type CorsDecision =
  | { kind: "no-origin" }
  | { kind: "allowed"; origin: string }
  | { kind: "denied" };

/** Normalise one value to a bare origin, or null if it is not usable.
 *  `https://a.example/`, `https://a.example` and `https://a.example/path` all
 *  collapse to `https://a.example` — an origin has no path, so a path in
 *  configuration cannot create a second, distinct entry. */
export function normaliseOrigin(value: string): string | null {
  const trimmed = value.trim();
  // A wildcard is not supported. Rejecting it explicitly means a well-meaning
  // "*" in configuration fails closed rather than opening the API to everyone.
  if (!trimmed || trimmed === "*") return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    // Includes the literal `null` origin browsers send from sandboxed contexts.
    return null;
  }
}

/**
 * Parse the configured allowlist. Malformed entries are skipped rather than
 * throwing — but a list that parses to nothing yields an EMPTY allowlist, which
 * denies every browser origin. Bad configuration can never become "allow all".
 */
export function readAllowedOrigins(raw: string | undefined = process.env.SNAPSHOT_ALLOWED_ORIGINS): Set<string> {
  const allowed = new Set<string>();
  for (const entry of (raw ?? "").split(",")) {
    const origin = normaliseOrigin(entry);
    if (origin) allowed.add(origin);
  }
  return allowed;
}

/**
 * Decide how to treat one request's Origin header.
 *
 * The visitor's origin is never logged here: an allowlist decision does not
 * need a record of who asked.
 */
export function resolveCors(
  originHeader: string | string[] | undefined,
  allowed: Set<string> = readAllowedOrigins()
): CorsDecision {
  const raw = Array.isArray(originHeader) ? originHeader[0] : originHeader;
  if (typeof raw !== "string" || !raw.trim()) return { kind: "no-origin" };

  const origin = normaliseOrigin(raw);
  // No allowlist configured means no browser origin is permitted. Fail closed.
  if (!origin || !allowed.has(origin)) return { kind: "denied" };
  return { kind: "allowed", origin };
}

/**
 * Headers to merge into every browser-readable response.
 *
 * `Vary: Origin` is sent whenever an Origin was present — including on a denial —
 * so a shared cache can never serve one origin's response to another.
 */
export function corsHeaders(decision: CorsDecision): Record<string, string> {
  if (decision.kind === "allowed") {
    return { "Access-Control-Allow-Origin": decision.origin, Vary: "Origin" };
  }
  if (decision.kind === "denied") {
    return { Vary: "Origin" };
  }
  return {};
}

/** Preflight response headers for an allowed origin. The API accepts only
 *  POST, and only a JSON content type, so the advertised surface is exactly
 *  that and nothing more. */
export function preflightHeaders(decision: CorsDecision): Record<string, string> {
  return {
    ...corsHeaders(decision),
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    // Conservative: long enough to spare a preflight per interaction, short
    // enough that an allowlist change takes effect the same day.
    "Access-Control-Max-Age": "600",
  };
}

/** One operator-facing line describing the browser boundary, for the startup
 *  log. Counts only — configured origins are not printed, so the log does not
 *  become a place the allowlist leaks from. */
export function corsConfigSummary(allowed: Set<string> = readAllowedOrigins()): string {
  return allowed.size === 0
    ? "no browser origins allowed (SNAPSHOT_ALLOWED_ORIGINS is unset or unusable) — direct/non-browser callers are unaffected"
    : `${allowed.size} browser origin(s) allowed`;
}
