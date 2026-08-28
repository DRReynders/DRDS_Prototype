// Transactional email: sends the Growth Snapshot after opt-in, plus an honest,
// non-overselling description of the paid tiers. Provider: Resend (plain REST
// call — no SDK dependency). Email is persistence, never a gate: the Snapshot
// was already shown before this is ever called.
//
// Observation-boundary pass: this renders the PUBLIC projection. It used to
// render the internal GrowthSnapshot, leading with a Primary Constraint, and
// its tier copy claimed the free Snapshot "identifies the single biggest
// constraint we could find" — a judgement claim on the one public surface that
// no site copy reaches. This module can no longer import GrowthSnapshot; it has
// no way to know what a constraint is.

import { BOUNDARY_NOTE, EMPTY_STATE } from "./projection/public-snapshot.js";
import { GROWTH_REPORT_PILOT_PRICE } from "./product.js";
import type { ReportEnquiry } from "./web/report-enquiry.js";
import type { PublicSignal, PublicSnapshot, PublicUnsettled } from "./types.js";

export class EmailNotConfiguredError extends Error {
  constructor() {
    super(
      "Email sending is not configured (RESEND_API_KEY is not set). " +
        "The Snapshot was still shown on screen — email is persistence, not a gate."
    );
  }
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Brand palette, taken from drdigitalsystems.co.za's own stylesheet (not
// invented here) so the email reads as one product with the site, not a
// separate tool. Email clients need literal hex + table layout — no CSS
// variables, no custom @font-face reliance, so fonts fall back to system
// serif/sans stacks that approximate Playfair Display / Inter.
const INK = "#0D1B2A"; // primary text / heading
const SLATE = "#4A5568"; // secondary text
const MUTED = "#ABAFB5"; // hints, footnotes
const PAPER = "#F8F7F4"; // page background (warm, not stark white)
const HAIRLINE = "#E5E5E5"; // dividers
const GOLD = "#C9A84C"; // accent — used as a rule/underline only, never a fill
const SERIF = "Georgia, 'Playfair Display', 'Times New Roman', serif";
const SANS = "'Segoe UI', Inter, Arial, sans-serif";

function section(label: string, body: string): string {
  return `<tr><td style="padding:0 0 28px">
    <div style="font-family:${SANS};font-size:13px;font-weight:600;color:${SLATE};margin:0 0 8px">${esc(label)}</div>
    <div style="font-family:${SANS};font-size:15px;line-height:1.7;color:${INK}">${esc(body)}</div>
  </td></tr>
  <tr><td style="padding:0 0 28px;border-top:1px solid ${HAIRLINE};font-size:0;line-height:0">&nbsp;</td></tr>`;
}

// One observation: what we saw, then the counted detail behind it. The proof
// line is deliberately quieter than the statement — it is a receipt, not a
// second finding, and it must not read as a stacked list of complaints.
function signalRow(s: PublicSignal): string {
  return `<tr><td style="padding:0 0 16px">
    <div style="font-family:${SANS};font-size:15px;line-height:1.7;color:${INK}">${esc(s.statement)}</div>
    <div style="font-family:${SANS};font-size:13px;line-height:1.6;color:${SLATE};margin-top:4px">${esc(s.proof)}</div>
  </td></tr>`;
}

function unsettledRow(u: PublicUnsettled): string {
  return `<tr><td style="padding:0 0 16px">
    <div style="font-family:${SANS};font-size:15px;line-height:1.7;color:${INK}">We could not settle ${esc(u.question)}.</div>
    <div style="font-family:${SANS};font-size:13px;line-height:1.6;color:${SLATE};margin-top:4px">${esc(u.reason)}</div>
  </td></tr>`;
}

function listSection(label: string, rows: string[], emptyCopy: string): string {
  const body = rows.length
    ? rows.join("")
    : `<tr><td style="padding:0 0 16px"><div style="font-family:${SANS};font-size:15px;line-height:1.7;color:${INK}">${esc(
        emptyCopy
      )}</div></td></tr>`;
  return `<tr><td style="padding:0 0 12px">
    <div style="font-family:${SANS};font-size:13px;font-weight:600;color:${SLATE};margin:0 0 10px">${esc(label)}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${body}</table>
  </td></tr>
  <tr><td style="padding:0 0 24px;border-top:1px solid ${HAIRLINE};font-size:0;line-height:0">&nbsp;</td></tr>`;
}

// Tier descriptions follow Product Council guidance: invite, never oversell,
// never promise content that does not exist yet, never gate anything.
//
// Rewritten in the observation-boundary pass. The previous copy told the reader
// the free Snapshot "identifies the single biggest constraint", described the
// Blueprint as a prioritised plan answering "what to do first, second, third",
// and said neither paid tier was available to order — three statements the
// current ladder contradicts. Availability wording now states only what is
// ratified: the Report is open by enquiry while DRDS works with a limited
// number of early clients, and the Blueprint is conditional on a Report showing
// it is warranted.
//
// The price IS stated, and comes from `product.json` via src/product.ts — the
// same file the website reads. It is never written down a second time here: a
// visitor quoted one number on the site and another in their Snapshot email has
// been given a reason to trust neither. No date and no capacity figure is
// invented, and no payment is taken by this email or offered from it.
const TIER_COPY = `
  <tr><td style="padding:8px 0 8px">
    <div style="font-family:${SANS};font-size:13px;font-weight:600;color:${SLATE};margin:0 0 12px">Where this can go next</div>
    <div style="font-family:${SANS};font-size:14px;line-height:1.7;color:${INK}">
      Your Growth Snapshot states what your public pages show. Deciding which of it
      matters most is a different kind of work:
    </div>
  </td></tr>
  <tr><td style="padding:0 0 6px">
    <div style="font-family:${SANS};font-size:14px;line-height:1.7;color:${INK}">
      <strong>Growth Report</strong> &mdash; the judgement layer. A human diagnosis of the
      constraint actually limiting your growth, the constraints connected to it, and the
      order in which they should be addressed &mdash; with an Owner Report, a Practitioner
      Brief and a walkthrough.
    </div>
  </td></tr>
  <tr><td style="padding:0 0 20px">
    <div style="font-family:${SANS};font-size:14px;line-height:1.7;color:${SLATE}">
      Controlled pilot: <strong style="color:${INK}">${esc(
        GROWTH_REPORT_PILOT_PRICE
      )}</strong>. Enquiry first &mdash; nothing is charged by this email or by the enquiry form.
    </div>
  </td></tr>
  <tr><td style="padding:0 0 20px">
    <div style="font-family:${SANS};font-size:14px;line-height:1.7;color:${INK}">
      <strong>Growth Blueprint</strong> &mdash; a deeper investigation, undertaken only where
      a Growth Report shows it is warranted. It is never the default next step.
    </div>
  </td></tr>
  <tr><td style="padding:0 0 8px">
    <div style="font-family:${SANS};font-size:14px;line-height:1.7;color:${SLATE}">
      The Growth Report is available by enquiry while DRDS works with a limited number of
      early clients. We review every enquiry before invoicing. If you would like to talk it
      through, just reply to this email.
    </div>
  </td></tr>`;

export function renderSnapshotEmailHtml(businessName: string, s: PublicSnapshot): string {
  const preparedDate = new Date().toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" });
  const r = s.evidenceReceipt;
  const pagesLine = r.pagesInspectedCount
    ? `We read ${r.pagesInspectedCount} of your published page${r.pagesInspectedCount === 1 ? "" : "s"} ` +
      `and looked at ${r.signalsChecked} thing${r.signalsChecked === 1 ? "" : "s"}, of which ${r.signalsSettled} settled.`
    : "No published page could be read on this run.";

  return `<!doctype html>
<html>
<body style="margin:0;padding:0;background:${PAPER}">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAPER}">
    <tr><td align="center" style="padding:40px 16px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#FFFFFF;border:1px solid ${HAIRLINE};border-radius:8px">
        <tr><td style="padding:40px 44px 8px">
          <div style="font-family:${SANS};font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:${MUTED}">Growth Snapshot</div>
        </td></tr>
        <tr><td style="padding:6px 44px 4px">
          <div style="font-family:${SERIF};font-size:24px;font-weight:400;color:${INK}">${esc(businessName)}</div>
        </td></tr>
        <tr><td style="padding:0 44px 24px">
          <div style="font-family:${SANS};font-size:13px;color:${SLATE}">Prepared ${preparedDate} &middot; based on publicly observable evidence</div>
        </td></tr>

        <tr><td style="padding:0 44px 32px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${GOLD};border-bottom:1px solid ${HAIRLINE}">
            <tr><td style="padding:22px 0">
              <div style="font-family:${SERIF};font-size:19px;line-height:1.55;color:${INK}">${esc(s.businessRead)}</div>
            </td></tr>
          </table>
        </td></tr>

        <tr><td style="padding:0 44px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            ${listSection("What we can see", s.whatWeCanSee.map(signalRow), EMPTY_STATE.whatWeCanSee)}
            ${listSection("What is working", s.whatIsWorking.map(signalRow), EMPTY_STATE.whatIsWorking)}
            ${listSection(
              "What we could not settle",
              s.whatWeCouldNotSettle.map(unsettledRow),
              EMPTY_STATE.whatWeCouldNotSettle
            )}
            ${section("How confident we are in this evidence", s.evidenceConfidence)}
          </table>
        </td></tr>

        <tr><td style="padding:0 44px 28px">
          <div style="font-family:${SANS};font-size:13px;font-weight:600;color:${SLATE};margin:0 0 8px">What we looked at</div>
          <div style="font-family:${SANS};font-size:14px;line-height:1.7;color:${INK}">${esc(pagesLine)}</div>
          <div style="font-family:${SANS};font-size:13px;line-height:1.6;color:${SLATE};margin-top:8px">
            ${r.pagesInspected.map((u) => esc(u)).join("<br>")}
          </div>
          <div style="font-family:${SANS};font-size:12px;line-height:1.6;color:${MUTED};margin-top:12px">
            ${r.limitations.map((l) => esc(l)).join("<br>")}
          </div>
        </td></tr>

        <tr><td style="padding:0 44px 32px">
          <div style="font-family:${SANS};font-size:13px;line-height:1.6;color:${SLATE};font-style:italic">${esc(
            s.boundaryNote || BOUNDARY_NOTE
          )}</div>
        </td></tr>

        <tr><td style="padding:0 44px 8px;border-top:1px solid ${HAIRLINE}">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            ${TIER_COPY}
          </table>
        </td></tr>

        <tr><td style="padding:24px 44px 40px;border-top:1px solid ${HAIRLINE}">
          <div style="font-family:${SANS};font-size:12px;color:${MUTED}">
            You received this one email because you asked us to send your Growth Snapshot.
            There is no mailing list and no account.
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// --- One transport, two messages ---------------------------------------------
//
// Provider: Resend, over a plain REST call — no SDK dependency. Both the
// visitor-facing Snapshot email and the internal Growth Report enquiry go
// through this single function, so there is one place that knows a provider
// exists, one timeout, one failure shape and one set of credentials.
//
// `sendEmail` reads a module-level binding rather than calling the provider
// directly, so an offline test can substitute a stub and prove exactly what
// would have been sent — without a key, and without a request leaving the
// machine. Production never touches the seam: the default IS the real transport.

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  /** Plain-text alternative. Optional — the Snapshot email is HTML only. */
  text?: string;
  /** Overrides EMAIL_FROM for messages that are not from the Snapshot sender. */
  from?: string;
}

export type EmailTransport = (message: EmailMessage) => Promise<{ provider: string; id?: string }>;

const DEFAULT_FROM = "DRDS Growth Snapshot <snapshot@drdigitalsystems.co.za>";

async function resendTransport(message: EmailMessage): Promise<{ provider: string; id?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new EmailNotConfiguredError();
  const from = message.from || process.env.EMAIL_FROM || DEFAULT_FROM;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: [message.to],
      subject: message.subject,
      html: message.html,
      ...(message.text ? { text: message.text } : {}),
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Email provider returned ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as { id?: string };
  return { provider: "resend", id: data.id };
}

let transport: EmailTransport = resendTransport;

/** TEST SEAM ONLY. Pass a stub to capture what would be sent; pass null to put
 *  the real provider back. Nothing in production calls this. */
export function setEmailTransport(next: EmailTransport | null): void {
  transport = next ?? resendTransport;
}

export function sendEmail(message: EmailMessage): Promise<{ provider: string; id?: string }> {
  return transport(message);
}

export async function sendSnapshotEmail(
  to: string,
  businessName: string,
  snapshot: PublicSnapshot
): Promise<{ provider: string; id?: string }> {
  return sendEmail({
    to,
    subject: `Your Growth Snapshot — ${businessName}`,
    html: renderSnapshotEmailHtml(businessName, snapshot),
  });
}

// --- Growth Report enquiry: the internal notification -------------------------
//
// This is an INTERNAL email to DRDS, not a message to the person who submitted
// the form. Nothing is sent to them by this route: no confirmation, no
// auto-reply, no marketing, no list. A human reads this and replies personally,
// which is the entire point of an enquiry being an enquiry.
//
// It is also the ONLY record of the submission. There is no database, no CRM and
// no lead store, so a delivery failure means the enquiry is genuinely lost —
// which is why the route reports a failure to the visitor rather than thanking
// them for something that never arrived.

export class EnquiryRecipientNotConfiguredError extends Error {
  constructor() {
    super(
      "DRDS_REPORT_ENQUIRY_TO is not set. The Growth Report enquiry route refuses to send rather than " +
        "falling back to an unrelated recipient."
    );
  }
}

/** Where an enquiry goes. Explicit configuration or nothing: silently routing a
 *  prospect's details to whichever address happened to be configured for some
 *  other purpose is worse than refusing to send at all. */
export function reportEnquiryRecipient(): string {
  const to = (process.env.DRDS_REPORT_ENQUIRY_TO ?? "").trim();
  if (!to) throw new EnquiryRecipientNotConfiguredError();
  return to;
}

export function reportEnquirySubject(businessName: string): string {
  return `Growth Report enquiry — ${businessName}`;
}

function enquiryRow(label: string, value: string): string {
  return `<tr><td style="padding:0 0 18px">
    <div style="font-family:${SANS};font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:${MUTED};margin:0 0 5px">${esc(
    label
  )}</div>
    <div style="font-family:${SANS};font-size:15px;line-height:1.6;color:${INK};white-space:pre-wrap">${esc(
    value
  )}</div>
  </td></tr>`;
}

/** Every submitted value is written through `esc`, so a submission containing
 *  markup, a link or a script tag arrives as the literal text that was typed. */
export function renderReportEnquiryEmailHtml(enquiry: ReportEnquiry, submittedAt: string): string {
  return `<!doctype html>
<html>
<body style="margin:0;padding:0;background:${PAPER}">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAPER}">
    <tr><td align="center" style="padding:32px 16px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#FFFFFF;border:1px solid ${HAIRLINE};border-radius:8px">
        <tr><td style="padding:32px 40px 4px">
          <div style="font-family:${SANS};font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:${MUTED}">Growth Report enquiry</div>
        </td></tr>
        <tr><td style="padding:6px 40px 6px">
          <div style="font-family:${SERIF};font-size:23px;font-weight:400;color:${INK}">${esc(enquiry.businessName)}</div>
        </td></tr>
        <tr><td style="padding:0 40px 22px">
          <div style="font-family:${SANS};font-size:13px;color:${SLATE};border-bottom:1px solid ${GOLD};padding-bottom:16px">Submitted ${esc(
    submittedAt
  )}</div>
        </td></tr>
        <tr><td style="padding:0 40px 8px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            ${enquiryRow("Name", enquiry.name)}
            ${enquiryRow("Email", enquiry.email)}
            ${enquiryRow("Business", enquiry.businessName)}
            ${enquiryRow("Website", enquiry.businessWebsite)}
            ${enquiryRow("Why now", enquiry.context || NOT_ANSWERED)}
          </table>
        </td></tr>
        <tr><td style="padding:16px 40px 32px;border-top:1px solid ${HAIRLINE}">
          <div style="font-family:${SANS};font-size:12px;line-height:1.6;color:${MUTED}">
            Sent by the DRDS website. This enquiry is not stored anywhere else — this email is the record.
            Nothing has been charged, and no confirmation email was sent to the sender.
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

const NOT_ANSWERED = "— not answered —";

/** Plain-text alternative, carrying exactly the same fields. */
export function renderReportEnquiryEmailText(enquiry: ReportEnquiry, submittedAt: string): string {
  return [
    "Growth Report enquiry",
    "",
    `Submitted: ${submittedAt}`,
    `Name:      ${enquiry.name}`,
    `Email:     ${enquiry.email}`,
    `Business:  ${enquiry.businessName}`,
    `Website:   ${enquiry.businessWebsite}`,
    "",
    "Why now:",
    enquiry.context || "(not answered)",
    "",
    "Sent by the DRDS website. This email is the only record of the enquiry.",
  ].join("\n");
}

export async function sendReportEnquiryEmail(
  enquiry: ReportEnquiry,
  submittedAt: string
): Promise<{ provider: string; id?: string }> {
  // Resolved BEFORE anything is rendered or sent: a missing recipient is a
  // configuration failure, and it must surface as one rather than as a
  // half-attempted delivery.
  const to = reportEnquiryRecipient();
  return sendEmail({
    to,
    subject: reportEnquirySubject(enquiry.businessName),
    text: renderReportEnquiryEmailText(enquiry, submittedAt),
    html: renderReportEnquiryEmailHtml(enquiry, submittedAt),
  });
}
