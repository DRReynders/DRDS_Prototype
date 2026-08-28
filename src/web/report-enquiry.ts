// Validation for the Growth Report enquiry form.
//
// A pure module: no I/O, no email, no network, no environment. It turns an
// arbitrary parsed JSON body from the public internet into either a normalised
// enquiry or a set of field-level reasons — and nothing else. That is what lets
// the whole input contract be exercised offline, exhaustively and for free.
//
// What this deliberately is NOT:
//   · a diagnosis. Nothing here interprets, scores or judges an enquiry. Facts
//     come from systems, context comes from people, judgement comes from
//     consultants — and this is the "context from people" seam, nothing more.
//   · a qualification gate. The form is short on purpose. Every field here is
//     something DRDS genuinely cannot derive for itself.
//
// The returned messages are OUR strings, chosen from a fixed set. No caller
// input is ever interpolated into them, so a rejection response cannot become a
// reflection surface.

/** Bounds. Generous enough for a real person, small enough that a bounded body
 *  cannot become a payload. The request body itself is capped separately by the
 *  server's reader, so these are the second bound, not the only one. */
export const ENQUIRY_LIMITS = {
  name: 120,
  email: 254, // the practical maximum length of an addressable mailbox
  businessName: 160,
  businessWebsite: 300,
  context: 1200,
} as const;

/** The hidden field a person never sees and never fills.
 *
 *  Named for nothing a password manager or browser autofill recognises — a
 *  honeypot called "name", "company" or "phone" gets filled by autofill and
 *  turns real prospects into rejected bots. */
export const HONEYPOT_FIELD = "contactPreference";

/** One validated enquiry. Every string here is trimmed and within bounds. */
export interface ReportEnquiry {
  name: string;
  email: string;
  businessName: string;
  businessWebsite: string;
  /** The one context answer. Optional — an empty string means the person chose
   *  not to add anything, which is a legitimate enquiry, not an invalid one. */
  context: string;
}

export type EnquiryValidation =
  | { ok: true; enquiry: ReportEnquiry }
  /** `fields` maps a field name to the message the form shows beside it.
   *  `rejected` is the field-name list only — it is what gets logged, so that a
   *  rejection is operationally visible without the submitted values being. */
  | { ok: false; fields: Record<string, string>; rejected: string[] };

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

// Same shape the Snapshot email route has always used. Deliberately permissive:
// an address is proved by delivery, not by a regular expression, and a stricter
// pattern's only reliable effect is to reject real people with unusual
// addresses. Length is bounded separately.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Normalise a business website to an absolute http(s) URL, or null.
 *
 * People type `acme.co.za`, and refusing that would be pedantry rather than
 * validation, so a missing scheme is supplied. Anything that is not plainly a
 * hostname is refused: no other scheme, no credentials, no whitespace.
 *
 * NOTHING FETCHES THIS. It is written into an internal email for a human to
 * read, so this is a shape check, not a reachability check and not an SSRF
 * boundary — the enquiry route never makes an outbound request to it.
 */
export function normaliseBusinessWebsite(raw: string): string | null {
  const value = raw.trim();
  if (!value || /\s/.test(value)) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  // Credentials in a URL are never something a person means to type here.
  if (url.username || url.password) return null;

  // A real public host: at least one dot, and a final label that looks like a
  // TLD. This keeps `localhost`, bare words and typos out without pretending to
  // validate that the domain exists.
  const host = url.hostname.toLowerCase();
  if (!/^[a-z0-9.-]+$/.test(host)) return null;
  const labels = host.split(".");
  if (labels.length < 2) return null;
  if (labels.some((l) => l.length === 0)) return null;
  if (!/^[a-z]{2,}$/.test(labels[labels.length - 1])) return null;

  return url.toString();
}

/** True when the hidden field carries anything at all. A person cannot fill it;
 *  a form-filling script fills everything it finds. */
export function isHoneypotTripped(body: Record<string, unknown>): boolean {
  return asString(body[HONEYPOT_FIELD]).length > 0;
}

/**
 * Validate one submitted enquiry.
 *
 * Every failing field is reported at once. Returning the first error only would
 * make a person fix one thing, resubmit, and be told about the next — which is
 * friction we are deliberately not adding to a four-field form.
 */
export function validateReportEnquiry(body: Record<string, unknown>): EnquiryValidation {
  const fields: Record<string, string> = {};

  const name = asString(body.name);
  if (!name) fields.name = "Please tell us your name.";
  else if (name.length > ENQUIRY_LIMITS.name) fields.name = "That name is longer than we can accept.";

  const email = asString(body.email);
  if (!email) fields.email = "Please give us an email address to reply to.";
  else if (email.length > ENQUIRY_LIMITS.email) fields.email = "That email address is longer than we can accept.";
  else if (!EMAIL.test(email)) fields.email = "That doesn't look like an email address. Please check it.";

  const businessName = asString(body.businessName);
  if (!businessName) fields.businessName = "Please tell us the name of your business.";
  else if (businessName.length > ENQUIRY_LIMITS.businessName)
    fields.businessName = "That business name is longer than we can accept.";

  const rawWebsite = asString(body.businessWebsite);
  let businessWebsite = "";
  if (!rawWebsite) {
    fields.businessWebsite = "Please give us your business website.";
  } else if (rawWebsite.length > ENQUIRY_LIMITS.businessWebsite) {
    fields.businessWebsite = "That address is longer than we can accept.";
  } else {
    const normalised = normaliseBusinessWebsite(rawWebsite);
    if (!normalised) fields.businessWebsite = "That doesn't look like a website address. Please check it.";
    else businessWebsite = normalised;
  }

  const context = asString(body.context);
  if (context.length > ENQUIRY_LIMITS.context) {
    fields.context = `Please keep this under ${ENQUIRY_LIMITS.context} characters — a sentence or two is plenty.`;
  }

  const rejected = Object.keys(fields);
  if (rejected.length > 0) return { ok: false, fields, rejected };

  return { ok: true, enquiry: { name, email, businessName, businessWebsite, context } };
}
