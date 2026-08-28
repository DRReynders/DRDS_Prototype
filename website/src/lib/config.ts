// The single configuration seam for the Snapshot backend origin.
//
// No component, page or client script may hard-code a backend URL. They import
// SNAPSHOT_API_ORIGIN from here, so pointing the site at a staging backend — or
// at a different runtime entirely, some years from now — is one environment
// value, not a search-and-replace across the source tree.
//
// This module is imported from page frontmatter, so it evaluates at BUILD time:
// a missing production value fails the build with an actionable message rather
// than shipping a site whose Snapshot silently does nothing.

// Vite always supplies `import.meta.env`; plain Node does not. Reading it
// defensively lets an offline test import this module — and therefore import
// snapshot-client.ts, which depends on it — to exercise the real streaming and
// recovery logic outside a browser. Production behaviour is unchanged: under
// Vite the first branch always wins.
const ENV: Record<string, unknown> =
  (import.meta as unknown as { env?: Record<string, unknown> }).env ??
  (typeof process !== "undefined" ? (process.env as unknown as Record<string, unknown>) : {});

const RAW = ENV.PUBLIC_SNAPSHOT_API_ORIGIN;

// `npm run dev` against a locally running backend should not require a .env
// first. A production build must be explicit.
const DEV_FALLBACK = "http://localhost:3000";

function resolveOrigin(): string {
  const value = typeof RAW === "string" ? RAW.trim().replace(/\/+$/, "") : "";

  if (!value) {
    // `import.meta.env.DEV` verbatim, NOT a dynamic read: Vite replaces this
    // exact expression with `false` in a production build and then eliminates
    // this whole branch, which is what keeps the localhost fallback out of the
    // shipped bundle. Reading it through a variable defeats that and ships a
    // dev-only URL to real visitors. Only reached when no origin is configured
    // at all, which the build refuses below anyway.
    if (import.meta.env.DEV) {
      console.warn(
        `[drds] PUBLIC_SNAPSHOT_API_ORIGIN is not set — falling back to ${DEV_FALLBACK} for local development. ` +
          `Copy .env.example to .env to set it explicitly.`
      );
      return DEV_FALLBACK;
    }
    throw new Error(
      "PUBLIC_SNAPSHOT_API_ORIGIN is not set. The Growth Snapshot page cannot be built without knowing " +
        "which backend origin to call. Copy website/.env.example to website/.env and set it. " +
        "See website/README.md."
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("PUBLIC_SNAPSHOT_API_ORIGIN is not a valid absolute URL (expected e.g. https://host.example).");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("PUBLIC_SNAPSHOT_API_ORIGIN must use http or https.");
  }
  return parsed.origin;
}

/** Absolute origin of the Growth Snapshot API. Never ends with a slash. */
export const SNAPSHOT_API_ORIGIN: string = resolveOrigin();

/** Public routes the approved architecture defines. Kept in one place so
 *  navigation, CTAs and canonical links cannot drift apart. */
export const ROUTES = {
  home: "/",
  snapshot: "/snapshot/",
  start: "/start/",
} as const;

/** The live WordPress Strategy Call route.
 *
 *  It is NO LONGER the Growth Report enquiry channel: /start/ is operational and
 *  owns that flow end to end. What remains here is a general route for the two
 *  places where the enquiry form genuinely cannot serve — a visitor without
 *  JavaScript, and a visitor whose Growth Snapshot failed and who needs a person
 *  rather than a paid-Report enquiry form — plus the site footer. Referenced
 *  absolutely because it is a WordPress route, not a V2 one. */
export const STRATEGY_CALL_URL = "https://drdigitalsystems.co.za/strategy-call/";
