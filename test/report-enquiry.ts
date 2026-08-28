// Growth Report enquiry — the operational entry point, exercised for real and
// entirely offline. No network, no LLM calls, no cost, no email.
// Run: npx tsx test/report-enquiry.ts
//
//   The enquiry route is the cheap half of the product, and it must stay that
//   way structurally rather than by convention.
//
// This suite runs the REAL route on an ephemeral local port with the REAL
// validation, against a STUB email transport that records what would have been
// sent. Nothing leaves the machine, no key is read, and no message is delivered.
//
// The four things it exists to prove, because each is a way this endpoint could
// quietly become expensive or unsafe:
//
//   1. It never reaches the pipeline, a provider, the paid rate-limit bucket or
//      the daily budget. An enquiry costs nothing and must consume nothing.
//   2. Exactly one internal email is attempted for a valid enquiry, and none at
//      all for anything else — including a bot.
//   3. Submitted text is escaped where it lands in HTML, so a hostile
//      submission arrives in DRDS's inbox as the literal text that was typed.
//   4. Failures leak nothing: no stack, no provider name, no configuration.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import {
  EnquiryRecipientNotConfiguredError,
  renderReportEnquiryEmailHtml,
  renderReportEnquiryEmailText,
  reportEnquiryRecipient,
  reportEnquirySubject,
  sendReportEnquiryEmail,
  setEmailTransport,
  type EmailMessage,
} from "../src/email.js";
import {
  ENQUIRY_LIMITS,
  HONEYPOT_FIELD,
  isHoneypotTripped,
  normaliseBusinessWebsite,
  validateReportEnquiry,
} from "../src/web/report-enquiry.js";
import { resetRateLimit } from "../src/web/guards.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string): string => readFileSync(join(ROOT, rel), "utf8");

// A deployed-like environment for the SNAPSHOT guards, so that any accidental
// dependency on them would be visible rather than masked by a refusal. The
// enquiry route must not consult either of these — section 6 proves it.
process.env.MAX_DAILY_COST_USD = "5.00";
process.env.RATE_LIMIT_RUNS_PER_HOUR = "4";
process.env.DRDS_LLM_PROVIDER = "mock";
process.env.DRDS_REPORT_ENQUIRY_TO = "enquiries@test.invalid";
// Explicitly absent: the stub transport replaces the provider entirely, and a
// key must not be needed — nor read — for any of this to run.
delete process.env.RESEND_API_KEY;

let failed = 0;
function check(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond || !detail ? "" : `  -> ${detail}`}`);
  if (!cond) failed++;
}

// ─── The email seam ──────────────────────────────────────────────────────────
//
// Every message the code would have sent is captured here instead. `outcome`
// lets one test make delivery fail without any provider, network or key being
// involved.
const sent: EmailMessage[] = [];
let outcome: "ok" | "throw" = "ok";
setEmailTransport(async (message) => {
  sent.push(message);
  if (outcome === "throw") {
    // Shaped like a real provider failure, complete with the internal detail
    // that must never reach a visitor.
    throw new Error("Email provider returned 500: {\"name\":\"internal_error\",\"key\":\"re_secret_abc123\"}");
  }
  return { provider: "stub", id: "stub-1" };
});
function resetEmail(): void {
  sent.length = 0;
  outcome = "ok";
}

// The limiter is checked before the body is parsed, so every request in this
// suite — valid, malformed or hostile — spends the enquiry allowance. Each
// sub-block therefore starts from a clean counter, so the one block that means
// to exercise the limit is the only one that ever trips it.
function fresh(): void {
  resetRateLimit();
  resetEmail();
}

const VALID = {
  name: "Thandi Mokoena",
  email: "thandi@acme.co.za",
  businessName: "Acme Plumbing",
  businessWebsite: "acme.co.za",
  context: "We have plenty of enquiries but very few of them convert.",
};

// ────────────────────────────────────────────────────────────────
console.log("=== 1. Website normalisation: forgiving about form, strict about shape ===");

check("a bare domain gains a scheme", normaliseBusinessWebsite("acme.co.za") === "https://acme.co.za/");
check("an https URL survives", normaliseBusinessWebsite("https://acme.co.za") === "https://acme.co.za/");
check("http is allowed", normaliseBusinessWebsite("http://acme.co.za")?.startsWith("http://") === true);
check("a path is preserved", normaliseBusinessWebsite("acme.co.za/about") === "https://acme.co.za/about");
check("www is preserved", normaliseBusinessWebsite("www.acme.co.za") === "https://www.acme.co.za/");
check("surrounding whitespace is harmless", normaliseBusinessWebsite("  acme.co.za  ") === "https://acme.co.za/");

const BAD_URLS: [string, string][] = [
  ["empty", ""],
  ["whitespace only", "   "],
  ["a bare word", "acme"],
  ["localhost", "localhost"],
  ["localhost with port", "http://localhost:3000"],
  ["a sentence", "my website is acme.co.za"],
  ["javascript scheme", "javascript:alert(1)"],
  ["data scheme", "data:text/html,<script>"],
  ["file scheme", "file:///etc/passwd"],
  ["mailto", "mailto:someone@acme.co.za"],
  ["credentials in the URL", "https://user:pass@acme.co.za"],
  ["trailing dot label", "acme.co.za."],
  ["numeric TLD", "acme.123"],
  ["an email address", "thandi@acme.co.za"],
];
for (const [label, value] of BAD_URLS) {
  check(`rejected: ${label}`, normaliseBusinessWebsite(value) === null, String(normaliseBusinessWebsite(value)));
}

console.log("\n=== 2. Field validation: every rule, and every rejection reported at once ===");

const ok = validateReportEnquiry({ ...VALID });
check("a valid enquiry is accepted", ok.ok === true);
check("the website is normalised on the way through", ok.ok && ok.enquiry.businessWebsite === "https://acme.co.za/");
check("values are trimmed", validateReportEnquiry({ ...VALID, name: "  Thandi  " }).ok === true);
check(
  "...and the trimmed value is what is kept",
  (() => {
    const r = validateReportEnquiry({ ...VALID, name: "  Thandi  " });
    return r.ok && r.enquiry.name === "Thandi";
  })()
);

check("context is optional", validateReportEnquiry({ ...VALID, context: "" }).ok === true);
check("an absent context field is fine", validateReportEnquiry({ ...VALID, context: undefined }).ok === true);

for (const field of ["name", "email", "businessName", "businessWebsite"] as const) {
  const missing = validateReportEnquiry({ ...VALID, [field]: "" });
  check(`\`${field}\` is required`, !missing.ok && missing.rejected.includes(field));
  const wrongType = validateReportEnquiry({ ...VALID, [field]: 42 });
  check(`\`${field}\` rejects a non-string`, !wrongType.ok && wrongType.rejected.includes(field));
}

const empty = validateReportEnquiry({});
check("an empty body reports all four required fields", !empty.ok && empty.rejected.length === 4, `${!empty.ok ? empty.rejected : ""}`);
const allBad = validateReportEnquiry({ name: "", email: "nope", businessName: "", businessWebsite: "acme" });
check("every failing field is reported at once, not just the first", !allBad.ok && allBad.rejected.length === 4);

for (const bad of ["nope", "no@domain", "@acme.co.za", "thandi@", "two @acme.co.za", "thandi acme.co.za"]) {
  const r = validateReportEnquiry({ ...VALID, email: bad });
  check(`malformed email rejected: "${bad}"`, !r.ok && r.rejected.includes("email"));
}
check("a normal address is accepted", validateReportEnquiry({ ...VALID, email: "a.b+c@sub.acme.co.za" }).ok === true);

console.log("\n--- length bounds ---");
const OVERSIZED: [keyof typeof ENQUIRY_LIMITS, string][] = [
  ["name", "n"],
  ["email", "e"],
  ["businessName", "b"],
  ["businessWebsite", "w"],
  ["context", "c"],
];
for (const [field, ch] of OVERSIZED) {
  const over = ch.repeat(ENQUIRY_LIMITS[field] + 1);
  const value = field === "email" ? `${over}@acme.co.za` : field === "businessWebsite" ? `${over}.co.za` : over;
  const r = validateReportEnquiry({ ...VALID, [field]: value });
  check(`\`${field}\` rejects ${ENQUIRY_LIMITS[field] + 1}+ characters`, !r.ok && r.rejected.includes(field));
}
check(
  "context exactly at the limit is accepted",
  validateReportEnquiry({ ...VALID, context: "c".repeat(ENQUIRY_LIMITS.context) }).ok === true
);

console.log("\n--- rejection messages are ours, never a reflection of input ---");
const hostile = "<script>alert('xss')</script>";
const reflected = validateReportEnquiry({ ...VALID, email: hostile, businessWebsite: hostile });
check("hostile input is rejected", !reflected.ok);
if (!reflected.ok) {
  const messages = Object.values(reflected.fields).join(" ");
  check("no submitted value appears in any message", !messages.includes("script") && !messages.includes("alert"));
  check("`rejected` carries field NAMES only, never values", reflected.rejected.every((f) => !f.includes("<")));
}

console.log("\n=== 3. Honeypot ===");
check("an absent hidden field is not tripped", isHoneypotTripped({ ...VALID }) === false);
check("an empty hidden field is not tripped", isHoneypotTripped({ [HONEYPOT_FIELD]: "" }) === false);
check("a whitespace-only hidden field is not tripped", isHoneypotTripped({ [HONEYPOT_FIELD]: "   " }) === false);
check("a filled hidden field is tripped", isHoneypotTripped({ [HONEYPOT_FIELD]: "http://spam" }) === true);
check(
  "the honeypot is not named for anything autofill recognises",
  !["name", "email", "phone", "company", "organization", "address", "url", "website"].includes(
    HONEYPOT_FIELD.toLowerCase()
  ),
  HONEYPOT_FIELD
);

console.log("\n=== 4. Email content: required fields present, hostile input inert ===");
{
  const enquiry = {
    name: 'Thandi "T" <Mokoena>',
    email: "thandi@acme.co.za",
    businessName: "Acme & Sons <b>Plumbing</b>",
    businessWebsite: "https://acme.co.za/",
    context: "<script>alert('xss')</script> & we want more of the right work.",
  };
  const at = "2026-08-28T09:15:00.000Z";
  const html = renderReportEnquiryEmailHtml(enquiry, at);
  const text = renderReportEnquiryEmailText(enquiry, at);

  check("subject names the business", reportEnquirySubject("Acme Plumbing").includes("Acme Plumbing"));
  check("subject says what it is", reportEnquirySubject("Acme Plumbing").startsWith("Growth Report enquiry"));

  for (const [label, value] of [
    ["email", enquiry.email],
    ["website", enquiry.businessWebsite],
  ] as const) {
    check(`html carries the ${label}`, html.includes(value));
    check(`text carries the ${label}`, text.includes(value));
  }
  check("html carries the submitted timestamp", html.includes(at));
  check("text carries the submitted timestamp", text.includes(at));
  check("text carries the name verbatim", text.includes(enquiry.name));
  check("text carries the business name verbatim", text.includes(enquiry.businessName));
  check("text carries the context verbatim", text.includes(enquiry.context));

  // The whole point: a submission containing markup must arrive as text.
  check("html escapes the submitted script tag", !html.includes("<script>"));
  check("...as an escaped entity instead", html.includes("&lt;script&gt;"));
  check("html escapes markup in a name", !html.includes("<Mokoena>") && html.includes("&lt;Mokoena&gt;"));
  check("html escapes markup in a business name", !html.includes("<b>Plumbing</b>"));
  check("html escapes a bare ampersand", html.includes("&amp;"));

  const emptyContext = renderReportEnquiryEmailHtml({ ...enquiry, context: "" }, at);
  check("an unanswered context says so rather than showing a blank", emptyContext.includes("not answered"));

  check("the email names no model vendor", !/anthropic|openai|claude|gpt-/i.test(html));
  check("the email carries no mailing-list machinery", !/unsubscribe|mailing list|newsletter|subscribe/i.test(html));
  check("the email states there is no other record", html.toLowerCase().includes("not stored anywhere else"));
}

console.log("\n=== 5. Recipient configuration: explicit or nothing ===");
{
  const original = process.env.DRDS_REPORT_ENQUIRY_TO;
  process.env.DRDS_REPORT_ENQUIRY_TO = "enquiries@test.invalid";
  check("a configured recipient is used", reportEnquiryRecipient() === "enquiries@test.invalid");
  check("surrounding whitespace is trimmed", (() => {
    process.env.DRDS_REPORT_ENQUIRY_TO = "  enquiries@test.invalid  ";
    return reportEnquiryRecipient() === "enquiries@test.invalid";
  })());

  for (const [label, value] of [["unset", undefined], ["empty", ""], ["whitespace", "   "]] as const) {
    if (value === undefined) delete process.env.DRDS_REPORT_ENQUIRY_TO;
    else process.env.DRDS_REPORT_ENQUIRY_TO = value;
    let threw = false;
    try {
      reportEnquiryRecipient();
    } catch (err) {
      threw = err instanceof EnquiryRecipientNotConfiguredError;
    }
    check(`\`${label}\` refuses rather than falling back`, threw);
  }

  // The fallback that must NOT exist: the Snapshot sender is unrelated
  // configuration and may never receive a prospect's details.
  delete process.env.DRDS_REPORT_ENQUIRY_TO;
  process.env.EMAIL_FROM = "DRDS Growth Snapshot <snapshot@drdigitalsystems.co.za>";
  resetEmail();
  let refused = false;
  try {
    await sendReportEnquiryEmail(VALID as never, "2026-08-28T09:15:00.000Z");
  } catch (err) {
    refused = err instanceof EnquiryRecipientNotConfiguredError;
  }
  check("an unconfigured recipient sends nothing at all", refused && sent.length === 0, `${sent.length} attempted`);

  process.env.DRDS_REPORT_ENQUIRY_TO = original ?? "enquiries@test.invalid";
}

console.log("\n=== 6. The route is structurally cheap ===");
{
  const source = read("src/web/server.ts");
  const start = source.indexOf("async function handleReportEnquiry");
  const end = source.indexOf("// The one thing a submitter is told");
  check("the handler was found to inspect", start > 0 && end > start, `${start}..${end}`);
  const handler = source.slice(start, end);

  check("runPipeline is never called from the enquiry route", !handler.includes("runPipeline"));
  check("no llm module is reachable from it", !handler.includes("llm"));
  check("no provider is named in it", !/anthropic|openai|claude|gpt-/i.test(handler));
  check("it never consults the daily budget", !handler.includes("dailyBudgetCheck"));
  check("it never records spend", !handler.includes("recordSpend"));
  check("it reads no run log", !handler.includes("findRunLogByRunId") && !handler.includes("updateRunLog"));
  check("no judgement object is in scope", !/growthSnapshot|reasoningResult|publicSnapshot/.test(handler));
  check("it uses its own rate-limit bucket", /bucket: "enquiry"/.test(handler));
  check("...with its own allowance, not the paid one", handler.includes("ENQUIRY_LIMIT_PER_HOUR"));
  check("it never flips the one-run-at-a-time flag", !/\bbusy\b/.test(handler));

  check("the route is behind the CORS allowlist", /API_ROUTES = new Set\([^)]*"\/api\/report-enquiry"/.test(source));
  check("it is registered as POST only", source.includes('req.method === "POST" && req.url === "/api/report-enquiry"'));
}

console.log("\n=== 7. The real route, end to end, on an ephemeral port ===");
{
  const { server } = await import("../src/web/server.js");
  await new Promise<void>((resolve) => {
    if (server.listening) return resolve();
    server.listen(0, () => resolve());
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const ENQUIRE = `${base}/api/report-enquiry`;

  async function post(body: unknown, headers: Record<string, string> = {}): Promise<{ status: number; json: Record<string, unknown> }> {
    const res = await fetch(ENQUIRE, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
    let parsed: unknown = {};
    try {
      parsed = await res.json();
    } catch {
      parsed = {};
    }
    return { status: res.status, json: (parsed ?? {}) as Record<string, unknown> };
  }

  resetRateLimit();
  resetEmail();

  console.log("\n--- a valid submission ---");
  const good = await post(VALID);
  check("valid submission is accepted", good.status === 200, `${good.status}`);
  check("...with the `received` state", good.json.state === "received", String(good.json.state));
  check("...and a message that promises only a review and a reply", /review|reply/i.test(String(good.json.message)));
  check("...that does not claim a Growth Report has started", !/production|started|underway|begun/i.test(String(good.json.message)));
  check("EXACTLY ONE email is attempted", sent.length === 1, `${sent.length}`);
  check("...to the configured internal recipient", sent[0]?.to === "enquiries@test.invalid", String(sent[0]?.to));
  check("...NOT to the person who submitted", sent[0]?.to !== VALID.email);
  check("...with a subject naming the business", String(sent[0]?.subject).includes(VALID.businessName));
  check("...carrying every submitted field", (() => {
    const body = `${sent[0]?.html}\n${sent[0]?.text}`;
    return [VALID.name, VALID.email, VALID.businessName, VALID.context].every((v) => body.includes(v));
  })());
  check("...and the normalised website", String(sent[0]?.text).includes("https://acme.co.za/"));
  check("the response echoes no submitted value", !JSON.stringify(good.json).includes(VALID.email));

  console.log("\n--- invalid submissions send nothing ---");
  const INVALID: [string, unknown][] = [
    ["missing everything", {}],
    ["malformed email", { ...VALID, email: "not-an-email" }],
    ["malformed website", { ...VALID, businessWebsite: "acme" }],
    ["missing name", { ...VALID, name: "" }],
    ["missing business name", { ...VALID, businessName: "" }],
    ["oversized name", { ...VALID, name: "n".repeat(ENQUIRY_LIMITS.name + 1) }],
    ["oversized context", { ...VALID, context: "c".repeat(ENQUIRY_LIMITS.context + 1) }],
    ["non-string fields", { name: 1, email: 2, businessName: 3, businessWebsite: 4 }],
    ["null body", "null"],
    ["malformed JSON", "{not json"],
  ];
  for (const [label, body] of INVALID) {
    fresh();
    const r = await post(body);
    check(`rejected: ${label}`, r.status >= 400, `${r.status}`);
    check(`...and NO email was attempted: ${label}`, sent.length === 0, `${sent.length}`);
    check(`...no stack or internal detail leaks: ${label}`, !/at \w+ \(|node:internal|SyntaxError|Error:/.test(JSON.stringify(r.json)), JSON.stringify(r.json).slice(0, 120));
  }

  fresh();
  const fieldErrors = await post({ ...VALID, email: "nope", businessWebsite: "acme" });
  check("a validation failure is 400", fieldErrors.status === 400, `${fieldErrors.status}`);
  check("...with the `invalid` state", fieldErrors.json.state === "invalid");
  const fields = fieldErrors.json.fields as Record<string, string>;
  check("...naming exactly the fields at fault", !!fields && "email" in fields && "businessWebsite" in fields && !("name" in fields));
  check("...and reflecting no submitted value", !JSON.stringify(fields).includes("nope"));

  console.log("\n--- an oversized body is refused before anything is sent ---");
  fresh();
  const huge = await post({ ...VALID, context: "x".repeat(20_000) });
  check("a body past the reader's cap is refused", huge.status >= 400, `${huge.status}`);
  check("...and no email was attempted", sent.length === 0, `${sent.length}`);
  check("...and no exception text leaks", !/Request too large|at \w+ \(/.test(JSON.stringify(huge.json)), JSON.stringify(huge.json).slice(0, 120));

  console.log("\n--- the honeypot ---");
  fresh();
  const bot = await post({ ...VALID, [HONEYPOT_FIELD]: "http://spam.example" });
  check("a bot submission is neutralised, not errored", bot.status === 200, `${bot.status}`);
  check("...and NO email is attempted", sent.length === 0, `${sent.length}`);
  check("...and the response teaches it nothing", bot.json.state === "received", String(bot.json.state));

  console.log("\n--- delivery failure is reported honestly ---");
  fresh();
  outcome = "throw";
  const failedSend = await post(VALID);
  check("a provider failure is a failure to the visitor", failedSend.status >= 500, `${failedSend.status}`);
  check("...never a thank-you", failedSend.json.state !== "received", String(failedSend.json.state));
  const failBody = JSON.stringify(failedSend.json);
  check("...and leaks no provider name", !/resend|anthropic|openai/i.test(failBody), failBody.slice(0, 120));
  check("...no key or secret", !failBody.includes("re_secret_abc123"));
  check("...no status code or internal payload", !failBody.includes("internal_error") && !failBody.includes("500:"));
  check("...and reads as temporary", /temporar|try again/i.test(String(failedSend.json.message)));
  outcome = "ok";

  console.log("\n--- an unconfigured recipient refuses rather than losing the enquiry silently ---");
  {
    const original = process.env.DRDS_REPORT_ENQUIRY_TO;
    delete process.env.DRDS_REPORT_ENQUIRY_TO;
    fresh();
    const r = await post(VALID);
    check("an unconfigured route answers 503", r.status === 503, `${r.status}`);
    check("...sends nothing", sent.length === 0, `${sent.length}`);
    check("...never says received", r.json.state !== "received", String(r.json.state));
    check("...and names no environment variable", !JSON.stringify(r.json).includes("DRDS_REPORT_ENQUIRY_TO"));
    process.env.DRDS_REPORT_ENQUIRY_TO = original ?? "enquiries@test.invalid";
  }

  console.log("\n--- the enquiry rate limit is its own bucket ---");
  {
    fresh();
    // A fixed client identity, so every request here counts against one bucket.
    const IP = { "X-Real-IP": "196.25.44.7" };
    const ALLOWED = 10;
    const statuses: number[] = [];
    for (let i = 0; i < ALLOWED + 2; i++) statuses.push((await post(VALID, IP)).status);
    check("the low-volume allowance is honoured", statuses.filter((s) => s === 200).length === ALLOWED, statuses.join(","));
    check("...and further attempts are refused", statuses.slice(ALLOWED).every((s) => s === 429), statuses.join(","));
    check("...with one email per accepted enquiry and none per refusal", sent.length === ALLOWED, `${sent.length}`);

    const limited = await post(VALID, IP);
    check("the refusal is calm and generic", /try again/i.test(String(limited.json.message)));
    check("...and mentions no bucket, budget or configuration", !/bucket|budget|limit per|rate.?limit/i.test(String(limited.json.message)), String(limited.json.message));

    // The proof that matters: the paid Snapshot allowance is untouched by all
    // of that. `/api/snapshot` is asked for a run and must be refused for
    // INPUT, not for rate limiting — which is only possible if the enquiry
    // traffic above consumed none of its four-per-hour allowance.
    const snap = await fetch(`${base}/api/snapshot`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...IP },
      body: JSON.stringify({ url: "" }),
    });
    const snapBody = (await snap.json()) as Record<string, unknown>;
    check(
      "12 enquiries consumed NONE of the paid Snapshot allowance",
      snap.status === 400 && snapBody.state === "input_failed",
      `${snap.status} ${String(snapBody.state)}`
    );
  }

  console.log("\n--- CORS: exactly the existing boundary, no wildcard ---");
  {
    const SITE = "https://v2.drdigitalsystems.co.za";
    const original = process.env.SNAPSHOT_ALLOWED_ORIGINS;
    process.env.SNAPSHOT_ALLOWED_ORIGINS = SITE;

    const preflight = await fetch(ENQUIRE, {
      method: "OPTIONS",
      headers: { Origin: SITE, "Access-Control-Request-Method": "POST" },
    });
    check("an allowlisted origin gets a preflight", preflight.status === 204, `${preflight.status}`);
    check("...echoing that exact origin", preflight.headers.get("access-control-allow-origin") === SITE);
    check("...never a wildcard", preflight.headers.get("access-control-allow-origin") !== "*");
    check("...advertising POST", String(preflight.headers.get("access-control-allow-methods")).includes("POST"));
    check("...and varying on Origin", String(preflight.headers.get("vary")).includes("Origin"));

    fresh();
    const allowed = await fetch(ENQUIRE, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: SITE },
      body: JSON.stringify(VALID),
    });
    check("an allowlisted origin can submit", allowed.status === 200, `${allowed.status}`);
    check("...and read the response", allowed.headers.get("access-control-allow-origin") === SITE);
    check("...having sent exactly one email", sent.length === 1, `${sent.length}`);

    fresh();
    const denied = await fetch(ENQUIRE, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://not-drds.example" },
      body: JSON.stringify(VALID),
    });
    check("a disallowed origin is refused", denied.status === 403, `${denied.status}`);
    check("...with no allow-origin header at all", denied.headers.get("access-control-allow-origin") === null);
    check("...and NO email attempted", sent.length === 0, `${sent.length}`);
    check("...revealing nothing about the allowlist", !(await denied.text()).includes("drdigitalsystems"));

    fresh();
    // No Origin header: CLI use and direct inspection, unchanged as ever.
    const direct = await post(VALID);
    check("a request with no Origin behaves exactly as before", direct.status === 200, `${direct.status}`);

    if (original === undefined) delete process.env.SNAPSHOT_ALLOWED_ORIGINS;
    else process.env.SNAPSHOT_ALLOWED_ORIGINS = original;
  }

  console.log("\n--- wrong method ---");
  const get = await fetch(ENQUIRE, { method: "GET" });
  check("GET is not a way in", get.status === 404, `${get.status}`);

  await new Promise<void>((resolve) => server.close(() => resolve()));
}

console.log("\n=== 8. Logging carries no private content ===");
{
  const source = read("src/web/server.ts");
  const start = source.indexOf("function logEnquiry");
  const end = source.indexOf("// The one thing a submitter is told");
  const block = source.slice(start, end);
  check("the enquiry log block was found", start > 0 && end > start);
  check("the context answer is never logged", !/\.context\b(?!\.length)/.test(block.replace(/context\.length/g, "")));
  check("the email address is never logged", !/enquiry\.email/.test(block));
  check("the name is never logged", !/enquiry\.name/.test(block));
  check("the email body is never logged", !/\.html|\.text\b/.test(block));
  check("rejections log field NAMES only", /fields: validation\.rejected/.test(block));
  check("no key or secret is logged", !/apiKey|RESEND_API_KEY|Authorization/.test(block));
}

console.log("\n=== 9. Frontend: the operational contract ===");
{
  const CLIENT_REL = "website/src/lib/enquiry-client.ts";
  const PAGE_REL = "website/src/pages/start.astro";
  // Same topology guard the delivery-resilience suite uses: `website/` is a
  // separate static deployment and is deliberately absent from the backend-only
  // production branch. A skip is announced as a skip, never counted as a pass.
  if (!existsSync(join(ROOT, CLIENT_REL))) {
    console.log(`SKIP — Astro source not present on backend-only branch (${CLIENT_REL})`);
  } else {
    const client = read(CLIENT_REL);
    const page = read(PAGE_REL);

    check("the client posts to the enquiry route", client.includes('"/api/report-enquiry"'));
    check("...on the existing API origin, not a second one", client.includes("SNAPSHOT_API_ORIGIN"));
    // An absolute URL to a real host. `https://${value}` in the website
    // normaliser is a scheme prefix, not a destination, so the pattern requires
    // a literal host character immediately after the slashes.
    check("...and hard-codes no backend URL", !/https?:\/\/[a-z0-9]/i.test(client));
    check("no localhost in the client", !client.includes("localhost"));
    check("the client never calls the Snapshot route", !client.includes("/api/snapshot"));
    check("the client names no provider", !/anthropic|openai|claude|gpt-|resend/i.test(client));

    // Behavioural, against the real module: the outcome mapping is what the
    // page renders, so it is the thing worth exercising rather than scanning.
    process.env.PUBLIC_SNAPSHOT_API_ORIGIN = "https://enquiry.test";
    const mod = (await import("../" + CLIENT_REL.replace(/\.ts$/, ".js"))) as {
      validateEnquiryInput(input: Record<string, string>): Record<string, string>;
      submitReportEnquiry(input: Record<string, string>, signal?: AbortSignal): Promise<{ kind: string; message: string; fields?: Record<string, string> }>;
    };

    const clientValid = mod.validateEnquiryInput({ ...VALID });
    check("the client accepts a valid enquiry", Object.keys(clientValid).length === 0, JSON.stringify(clientValid));
    check("the client catches a missing name", "name" in mod.validateEnquiryInput({ ...VALID, name: "" }));
    check("the client catches a malformed email", "email" in mod.validateEnquiryInput({ ...VALID, email: "nope" }));
    check("the client catches a malformed website", "businessWebsite" in mod.validateEnquiryInput({ ...VALID, businessWebsite: "acme" }));
    check("the client does NOT refuse what the server accepts", (() => {
      // Every form the server normalises must pass the client too, or a real
      // prospect is blocked by our own courtesy check.
      const accepted = ["acme.co.za", "https://acme.co.za", "http://acme.co.za", "www.acme.co.za/about", "acme.co.za/pricing"];
      return accepted.every((w) => !("businessWebsite" in mod.validateEnquiryInput({ ...VALID, businessWebsite: w })));
    })());

    const realFetch = globalThis.fetch;
    const stubFetch = (status: number, body: unknown): void => {
      globalThis.fetch = (async () =>
        new Response(JSON.stringify(body), {
          status,
          headers: { "Content-Type": "application/json" },
        })) as typeof fetch;
    };
    try {
      stubFetch(200, { state: "received", message: "Thank you — your enquiry is with us." });
      const received = await mod.submitReportEnquiry({ ...VALID });
      check("a 200 `received` maps to the success state", received.kind === "received", received.kind);

      stubFetch(400, { state: "invalid", message: "x", fields: { email: "That doesn't look like an email address." } });
      const invalid = await mod.submitReportEnquiry({ ...VALID });
      check("a 400 `invalid` maps to field errors", invalid.kind === "invalid" && !!invalid.fields?.email, invalid.kind);

      stubFetch(400, { state: "invalid", fields: { email: 12, nonsense: "ignored", context: "" } });
      const filtered = await mod.submitReportEnquiry({ ...VALID });
      check("only known string field messages survive", filtered.kind === "invalid" && Object.keys(filtered.fields ?? {}).length === 0, JSON.stringify(filtered.fields));

      for (const [label, status, body] of [
        ["429 rate limited", 429, { state: "rate_limited" }],
        ["503 unavailable", 503, { state: "unavailable" }],
        ["502 send failed", 502, { state: "send_failed" }],
        ["500 error", 500, { state: "error" }],
        ["an unrecognised state", 500, { state: "something_new" }],
        ["a non-JSON-object body", 200, "just a string"],
      ] as [string, number, unknown][]) {
        stubFetch(status, body);
        const r = await mod.submitReportEnquiry({ ...VALID });
        check(`${label} maps to a calm failure`, r.kind === "failed", r.kind);
        check(`...leaking nothing internal: ${label}`, !/resend|anthropic|stack|500|502|503/i.test(r.message), r.message);
      }

      globalThis.fetch = (async () => {
        throw new TypeError("Failed to fetch");
      }) as typeof fetch;
      const unreachable = await mod.submitReportEnquiry({ ...VALID });
      check("an unreachable backend is a calm failure", unreachable.kind === "failed", unreachable.kind);
      check("...with no exception text", !unreachable.message.includes("Failed to fetch"), unreachable.message);
    } finally {
      globalThis.fetch = realFetch;
    }

    console.log("\n--- the page itself ---");
    check("the page renders all four required fields", ["name", "email", "businessName", "businessWebsite"].every((f) => page.includes(`name="${f}"`)));
    check("...and the one context question", page.includes('name="context"'));
    check("...worded as approved", page.includes("What should we know about why you're looking at this now?"));
    check("the honeypot field is present", page.includes(`name="${HONEYPOT_FIELD}"`));
    check("...hidden from assistive technology", /start-form__trap"\s+aria-hidden="true"/.test(page));
    check("...and out of the tab order", /tabindex="-1"[\s\S]{0,80}?\/>/.test(page.slice(page.indexOf("start-form__trap"))));

    check("the form calls the enquiry client", page.includes("submitReportEnquiry"));
    check("...and never the Snapshot client", !page.includes("runSnapshot"));
    check("there is a submitting state", page.includes("Sending"));
    check("there is a success state", page.includes("start-success"));
    check("there is a failure state that keeps what was typed", page.includes("outcome.kind === \"failed\"") || page.includes("Temporary failure"));
    check("double-submit is prevented in flight", page.includes("inFlight"));
    check("...and the button is disabled while sending", /submit\.disabled = busy/.test(page));

    // The temporary scaffolding must be gone, not merely hidden.
    check("the disabled-form notice is gone", !page.includes("This form is not live yet"));
    check("the 'nothing is sent or stored' claim is gone", !/nothing you type here is sent or stored/i.test(page));
    check("the 'submission not yet available' button is gone", !page.includes("Submission not yet available"));
    // Checked against the RENDERED page, not the file: the frontmatter comment
    // legitimately explains what this page used to do, and a rule that forbids
    // naming the removed fallback in a comment would forbid the explanation of
    // why it was removed.
    const rendered = page.slice(page.indexOf("---", 3) + 3);
    check("the Strategy Call fallback no longer controls this flow", !page.includes("STRATEGY_CALL_URL") && !/strategy call/i.test(rendered));
    check("...and the page links to it nowhere", !page.includes("strategy-call"));

    // Privacy copy must be supportable by what the backend actually does.
    check("privacy copy says what the details are used for", /only to review your Growth Report enquiry and reply to you/i.test(page));
    check("...and rules out a mailing list", /does not\s+add you to a mailing list/i.test(page.replace(/\s+/g, " ")));
    check("...and does not promise a response time", !/within \d+ (hour|business day|day)/i.test(page));
    check("...and invents no scarcity", !/only \d+ (spots|places|slots)|hurry|limited time|act now/i.test(page));
    check("no payment is claimed to have been taken", /no payment, no card details/i.test(page));
    check("no claim that a Growth Report has started", !/your Growth Report (has|is now) (started|underway|in production)/i.test(page));

    console.log("\n--- without JavaScript the form does not pretend to work ---");
    // The generic Strategy Call used to be the answer here. It is deprecated,
    // and nothing replaced it, so the page has to be honest about its own
    // requirement instead of leaving a live button that sends nothing.
    check("a noscript notice explains the requirement", /<noscript>[\s\S]*?needs JavaScript enabled[\s\S]*?<\/noscript>/.test(page));
    check("...and offers no generic call in its place", !/strategy call|book a call/i.test(rendered));
    check("the submit button starts disabled in the markup", /id="start-submit"[^>]*\sdisabled/.test(page));
    check("...and the script enables it", /submit\.disabled = false;/.test(page));

    console.log("\n--- price conformity: the controlled pilot price is visible ---");
    const config = read("website/src/lib/config.ts");
    check("the price is defined once, in config", /GROWTH_REPORT_PILOT_PRICE = "R6,500"/.test(config));
    check("/start/ shows the price", page.includes("GROWTH_REPORT_PILOT_PRICE"));
    check("...labelled as the controlled pilot", /controlled pilot/i.test(rendered));
    check("...and hard-codes no second copy of the number", !/R\s?6[ ,.]?500/.test(rendered), "the number must come from config only");
    check("...naming what the fee buys", /Owner Report/i.test(rendered) && /Practitioner Brief/i.test(rendered) && /walkthrough/i.test(rendered));

    console.log("\n--- the accepted commercial sequence ---");
    const seq = rendered.slice(rendered.indexOf("start-terms__sequence"), rendered.indexOf("</ol>"));
    check("the sequence block was found", seq.length > 0);
    check("step 1 is the enquiry, with no payment", /enquiry/i.test(seq) && /no payment/i.test(seq));
    check("step 2 is human review", /we read it ourselves/i.test(seq) && /reply by email/i.test(seq));
    check("step 3 is invoice then EFT", /invoice/i.test(seq) && /EFT/i.test(seq));
    check("step 4 is production, after settlement", /production starts/i.test(seq));
    check("the order is enquiry -> review -> invoice -> production", (() => {
      const order = ["enquiry", "read it ourselves", "invoice", "Production starts"];
      let at = -1;
      return order.every((token) => {
        const next = seq.toLowerCase().indexOf(token.toLowerCase());
        if (next <= at) return false;
        at = next;
        return true;
      });
    })());
    check("submission is explicitly not acceptance", /not an acceptance/i.test(rendered));
    // Comment-stripped: the frontmatter explains WHY this is not a checkout,
    // and a rule that forbids the word in an explanation forbids the
    // explanation. Same convention public-snapshot-boundary.ts uses.
    const pageCode = page
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    check("no checkout, cart or card capture anywhere", !/checkout|add to cart|card number|cvv|payfast|stripe|paypal|yoco/i.test(pageCode));
    check("no payment automation is implied", !/pay now|buy now|purchase now|secure payment/i.test(rendered));
    check("no urgency or scarcity around the price", !/hurry|act now|limited time|only \d+ (spots|places|slots|left)|ends (soon|today)/i.test(rendered));

    console.log("\n--- the Snapshot handoff: still /start/, now with the price ---");
    const snapshotPage = read("website/src/pages/snapshot.astro");
    check("the Snapshot result CTA points at the start route", /href=\{ROUTES\.start\}/.test(snapshotPage));
    check("...and is still labelled 'Start a Growth Report'", snapshotPage.includes("Start a Growth Report"));
    check("ROUTES.start is still /start/", /start:\s*"\/start\/"/.test(config));
    const handoff = snapshotPage.slice(snapshotPage.indexOf("<aside class=\"handoff\">"), snapshotPage.indexOf("</aside>"));
    check("the handoff block was found", handoff.length > 0);
    check("the handoff shows the pilot price", handoff.includes("GROWTH_REPORT_PILOT_PRICE"));
    check("...labelled as the controlled pilot", /controlled pilot/i.test(handoff));
    check("...positioned BEFORE the CTA, not after it", handoff.indexOf("GROWTH_REPORT_PILOT_PRICE") < handoff.indexOf('id="report-cta"'));
    check("...stating that the form takes no payment", /nothing is charged/i.test(handoff));
    check("...and that review precedes invoicing", /review it before invoicing/i.test(handoff));

    // The observation/judgement boundary is owned by public-snapshot-boundary.ts
    // and must be untouched by a commercial-copy change. Re-asserted here so a
    // price edit that quietly leaked a constraint would fail in THIS suite too.
    console.log("\n--- the observation boundary is unchanged by the price copy ---");
    const snapshotCode = snapshotPage
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    for (const field of ["primaryConstraint", "secondaryConstraints", "howFixingItWillHelp", "verificationRequired"]) {
      check(`the Snapshot page still never reads ${field}`, !snapshotCode.includes(field));
    }
    check("the handoff still calls the Snapshot observation, not diagnosis", /This is observation\. The Growth Report is diagnosis\./.test(snapshotPage));
    check("the price copy makes no diagnostic claim", !/we (will )?(diagnose|find|identify) your (main )?constraint for R/i.test(snapshotPage));

    console.log("\n--- Strategy Call is deprecated across the Astro V2 funnel ---");
    const V2_SURFACES = [
      "website/src/pages/index.astro",
      "website/src/pages/snapshot.astro",
      "website/src/pages/start.astro",
      "website/src/components/SiteHeader.astro",
      "website/src/components/SiteFooter.astro",
      "website/src/layouts/BaseLayout.astro",
      "website/src/lib/config.ts",
      "website/src/lib/snapshot-states.ts",
      "website/src/lib/enquiry-client.ts",
    ];
    for (const rel of V2_SURFACES) {
      const src = read(rel);
      // Comments may explain the removal; rendered output and code may not
      // carry the link or the CTA.
      const code = src
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
        .replace(/<!--[\s\S]*?-->/g, "")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      check(`${rel} links to no Strategy Call route`, !code.includes("strategy-call"), rel);
      check(`${rel} renders no Strategy Call CTA`, !/strategy call/i.test(code), rel);
    }
    check("the STRATEGY_CALL_URL constant is gone entirely", !config.includes("STRATEGY_CALL_URL"));

    const footer = read("website/src/components/SiteFooter.astro");
    const footerLinks = [...footer.matchAll(/<li><a href=\{?([^>}]+)\}?>([^<]+)<\/a><\/li>/g)].map((m) => m[2].trim());
    check("the footer lists exactly Growth Snapshot and Growth Report", footerLinks.join(" | ") === "Growth Snapshot | Growth Report", footerLinks.join(" | "));
    check("...with no invented replacement item", footerLinks.length === 2, `${footerLinks.length}`);

    // A universal "book a call" is the shape being deprecated, not just the
    // words "Strategy Call". This catches a rename.
    for (const rel of V2_SURFACES) {
      const src = read(rel).replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/<!--[\s\S]*?-->/g, "").replace(/^\s*\/\/.*$/gm, "");
      check(`${rel} has no book-a-call CTA under any name`, !/book a (call|consult|chat|discovery)|schedule a call|free consultation|calendly|book a meeting/i.test(src), rel);
    }
  }
}

setEmailTransport(null);
console.log(`\n${failed === 0 ? "ALL PASSED" : `${failed} CHECK(S) FAILED`}`);
process.exit(failed === 0 ? 0 : 1);
