// The website's only knowledge of the Growth Report enquiry endpoint.
//
// Deliberately the smallest possible sibling of `snapshot-client.ts`: one POST,
// one JSON response, four recognised states. There is no stream, no recovery
// schedule and no run id, because an enquiry is a single cheap request rather
// than a two-minute paid computation — and pretending otherwise would be
// architecture for its own sake.
//
// What it never does:
//   · start, resume or reference a Growth Snapshot;
//   · claim a Growth Report has begun. Submitting an enquiry begins a review;
//   · take a payment, or imply one has been taken;
//   · interpolate anything the server returned into copy the site renders,
//     beyond the recognised states below and our own field messages.

// The one DRDS API origin. It is named for the Snapshot because that was the
// first thing it served; the enquiry endpoint is the same deployment on the
// same host, and giving it a second environment variable would mean two values
// that must never disagree. Renaming the constant is a later cleanup, not a
// reason to duplicate configuration.
import { SNAPSHOT_API_ORIGIN } from "./config.js";

const ENQUIRY_PATH = "/api/report-enquiry";

/** Bounds mirrored from the server's own limits (`src/web/report-enquiry.ts`).
 *  The server is authoritative; these exist so a person is told immediately
 *  rather than after a round trip. */
export const ENQUIRY_LIMITS = {
  name: 120,
  email: 254,
  businessName: 160,
  businessWebsite: 300,
  context: 1200,
} as const;

/** The hidden field the server treats as a bot signal. Named here so the form
 *  and the check cannot drift apart. */
export const HONEYPOT_FIELD = "contactPreference";

export interface EnquiryInput {
  name: string;
  email: string;
  businessName: string;
  businessWebsite: string;
  context: string;
}

export type EnquiryOutcome =
  /** Accepted. A human will read it and reply; nothing has been charged. */
  | { kind: "received"; message: string }
  /** Something on the form needs fixing. `fields` maps a field name to the
   *  message shown beside it. */
  | { kind: "invalid"; message: string; fields: Record<string, string> }
  /** Nothing was sent, and trying again later is the honest advice. */
  | { kind: "failed"; message: string };

const GENERIC_FAILURE =
  "We couldn't submit your enquiry just now. This is usually temporary — please try again shortly.";

const UNREACHABLE =
  "We couldn't send that just now — it looks like a connection problem. Please try again in a moment.";

const RATE_LIMITED =
  "You've sent a few enquiries from this connection already. Please try again a little later.";

const INVALID_SUMMARY = "Please check the highlighted fields and try again.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Mirrors `normaliseBusinessWebsite` on the server closely enough to catch a
 *  typo before the round trip, and deliberately no more strictly than it —
 *  a client check that refuses what the server would accept is worse than no
 *  client check at all. */
function looksLikeWebsite(raw: string): boolean {
  const value = raw.trim();
  if (!value || /\s/.test(value)) return false;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (url.username || url.password) return false;
  const labels = url.hostname.toLowerCase().split(".");
  return labels.length >= 2 && labels.every((l) => l.length > 0) && /^[a-z]{2,}$/.test(labels[labels.length - 1]);
}

/** Keep only string-valued entries, and only for fields this form actually has.
 *  A server response cannot introduce a message for a field the page does not
 *  render, and cannot smuggle a non-string into the DOM. */
function readFieldMessages(value: unknown): Record<string, string> {
  const known = ["name", "email", "businessName", "businessWebsite", "context"] as const;
  const out: Record<string, string> = {};
  if (!isRecord(value)) return out;
  for (const field of known) {
    const message = value[field];
    if (typeof message === "string" && message.trim()) out[field] = message.trim();
  }
  return out;
}

/**
 * Client-side validation, mirroring the server's rules.
 *
 * This is a courtesy, never a boundary: the server validates the same things
 * again and is the only authority. Its purpose is to spare a person a round
 * trip for a missing field.
 */
export function validateEnquiryInput(input: EnquiryInput): Record<string, string> {
  const fields: Record<string, string> = {};
  const name = input.name.trim();
  const email = input.email.trim();
  const businessName = input.businessName.trim();
  const businessWebsite = input.businessWebsite.trim();
  const context = input.context.trim();

  if (!name) fields.name = "Please tell us your name.";
  else if (name.length > ENQUIRY_LIMITS.name) fields.name = "That name is longer than we can accept.";

  if (!email) fields.email = "Please give us an email address to reply to.";
  else if (email.length > ENQUIRY_LIMITS.email) fields.email = "That email address is longer than we can accept.";
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    fields.email = "That doesn't look like an email address. Please check it.";

  if (!businessName) fields.businessName = "Please tell us the name of your business.";
  else if (businessName.length > ENQUIRY_LIMITS.businessName)
    fields.businessName = "That business name is longer than we can accept.";

  if (!businessWebsite) fields.businessWebsite = "Please give us your business website.";
  else if (businessWebsite.length > ENQUIRY_LIMITS.businessWebsite)
    fields.businessWebsite = "That address is longer than we can accept.";
  else if (!looksLikeWebsite(businessWebsite))
    fields.businessWebsite = "That doesn't look like a website address. Please check it.";

  if (context.length > ENQUIRY_LIMITS.context)
    fields.context = `Please keep this under ${ENQUIRY_LIMITS.context} characters — a sentence or two is plenty.`;

  return fields;
}

/**
 * Submit one Growth Report enquiry.
 *
 * Resolves with an outcome rather than throwing: every failure mode a visitor
 * can reach is a state the page renders calmly, and an unhandled rejection in a
 * submit handler is how a form ends up looking frozen.
 */
export async function submitReportEnquiry(input: EnquiryInput, signal?: AbortSignal): Promise<EnquiryOutcome> {
  let response: Response;
  try {
    response = await fetch(`${SNAPSHOT_API_ORIGIN}${ENQUIRY_PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: input.name,
        email: input.email,
        businessName: input.businessName,
        businessWebsite: input.businessWebsite,
        context: input.context,
      }),
      signal,
    });
  } catch {
    // Network-level: offline, DNS, TLS, or a cross-origin request the browser
    // refused. No exception text ever reaches the page.
    return { kind: "failed", message: UNREACHABLE };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { kind: "failed", message: GENERIC_FAILURE };
  }
  if (!isRecord(body)) return { kind: "failed", message: GENERIC_FAILURE };

  if (response.ok && body.state === "received") {
    return {
      kind: "received",
      // The server's own confirmation wording, used only when it is a string.
      message:
        typeof body.message === "string" && body.message.trim()
          ? body.message.trim()
          : "Thank you — your enquiry is with us. We'll review it and reply by email.",
    };
  }

  if (body.state === "invalid") {
    return { kind: "invalid", message: INVALID_SUMMARY, fields: readFieldMessages(body.fields) };
  }

  if (body.state === "rate_limited") {
    return { kind: "failed", message: RATE_LIMITED };
  }

  // "unavailable", "send_failed", "error", or any state this build does not
  // recognise. All of them mean the same thing to the person in front of the
  // form: it did not go through, and trying again shortly is the right advice.
  return { kind: "failed", message: GENERIC_FAILURE };
}
