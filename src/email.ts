// Transactional email: sends the Growth Snapshot after opt-in, plus an honest,
// non-overselling description of the two future paid tiers. Provider: Resend
// (plain REST call — no SDK dependency). Email is persistence, never a gate:
// the Snapshot was already shown before this is ever called.

import type { GrowthSnapshot } from "./types.js";

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

// Tier descriptions follow Product Council guidance: invite, never oversell,
// never promise content that does not exist yet, never gate anything.
const TIER_COPY = `
  <tr><td style="padding:8px 0 8px">
    <div style="font-family:${SANS};font-size:13px;font-weight:600;color:${SLATE};margin:0 0 12px">Where this can go next</div>
    <div style="font-family:${SANS};font-size:14px;line-height:1.7;color:${INK}">
      Your Growth Snapshot identifies the single biggest constraint we could find from
      publicly observable evidence. Two deeper pathways are being prepared:
    </div>
  </td></tr>
  <tr><td style="padding:0 0 12px">
    <div style="font-family:${SANS};font-size:14px;line-height:1.7;color:${INK}">
      <strong>Growth Report</strong> &mdash; a deeper look at this same constraint: the full
      reasoning behind it, what it is likely costing you, and what category of action
      addresses it. Still based on public evidence, no access needed.
    </div>
  </td></tr>
  <tr><td style="padding:0 0 20px">
    <div style="font-family:${SANS};font-size:14px;line-height:1.7;color:${INK}">
      <strong>Growth Blueprint</strong> &mdash; a complete, prioritised growth plan across
      multiple constraints, built with evidence you grant access to (such as your
      analytics), answering what to do first, second, third &mdash; and why.
    </div>
  </td></tr>
  <tr><td style="padding:0 0 8px">
    <div style="font-family:${SANS};font-size:14px;line-height:1.7;color:${SLATE}">
      Neither is available to order yet. If you would like to be first in line when the
      Growth Report opens, just reply to this email and say so.
    </div>
  </td></tr>`;

export function renderSnapshotEmailHtml(businessName: string, s: GrowthSnapshot): string {
  const preparedDate = new Date().toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" });
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
              <div style="font-family:${SERIF};font-size:19px;line-height:1.55;color:${INK}">${esc(s.primaryConstraint)}</div>
            </td></tr>
          </table>
        </td></tr>

        <tr><td style="padding:0 44px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            ${section("What is going well", s.whatIsGoingWell)}
            ${section("Why we think this", s.whyWeThinkThis)}
            ${section("What changes if this is fixed", s.howFixingItWillHelp)}
            ${section("Next steps", s.nextSteps)}
          </table>
        </td></tr>

        <tr><td style="padding:0 44px 32px">
          <div style="font-family:${SANS};font-size:13px;line-height:1.6;color:${SLATE};font-style:italic">${esc(s.confidencePlainLanguage)}</div>
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

export async function sendSnapshotEmail(
  to: string,
  businessName: string,
  snapshot: GrowthSnapshot
): Promise<{ provider: string; id?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new EmailNotConfiguredError();
  const from = process.env.EMAIL_FROM || "DRDS Growth Snapshot <snapshot@drdigitalsystems.co.za>";

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: [to],
      subject: `Your Growth Snapshot — ${businessName}`,
      html: renderSnapshotEmailHtml(businessName, snapshot),
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
