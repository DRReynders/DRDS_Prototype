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

const RAW = import.meta.env.PUBLIC_SNAPSHOT_API_ORIGIN;

// `npm run dev` against a locally running backend should not require a .env
// first. A production build must be explicit.
const DEV_FALLBACK = "http://localhost:3000";

function resolveOrigin(): string {
  const value = typeof RAW === "string" ? RAW.trim().replace(/\/+$/, "") : "";

  if (!value) {
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

/** The live WordPress Strategy Call route. It remains DRDS's working enquiry
 *  channel and must stay reachable until /start/ is genuinely valid, so it is
 *  referenced absolutely rather than as a V2 route. */
export const STRATEGY_CALL_URL = "https://drdigitalsystems.co.za/strategy-call/";
