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

function card(title: string, body: string): string {
  return `<div style="border:1px solid #ddd;border-radius:6px;padding:16px;margin:12px 0">
    <div style="font-size:12px;letter-spacing:.05em;text-transform:uppercase;color:#666;margin-bottom:6px">${esc(title)}</div>
    <div style="font-size:15px;line-height:1.5;color:#1a1a1a">${esc(body)}</div>
  </div>`;
}

// Tier descriptions follow Product Council guidance: invite, never oversell,
// never promise content that does not exist yet, never gate anything.
const TIER_COPY = `
  <h3 style="margin:24px 0 8px">Where this can go next</h3>
  <p style="font-size:14px;line-height:1.6;color:#333">
    Your Growth Snapshot identifies the single biggest constraint we could find from
    publicly observable evidence. Two deeper pathways are being prepared:
  </p>
  <p style="font-size:14px;line-height:1.6;color:#333">
    <strong>Growth Report</strong> — a deeper look at this same constraint: the full
    reasoning behind it, what it is likely costing you, and what category of action
    addresses it. Still based on public evidence, no access needed.
  </p>
  <p style="font-size:14px;line-height:1.6;color:#333">
    <strong>Growth Blueprint</strong> — a complete, prioritised growth plan across
    multiple constraints, built with evidence you grant access to (such as your
    analytics), answering what to do first, second, third — and why.
  </p>
  <p style="font-size:14px;line-height:1.6;color:#333">
    Neither is available to order yet. If you'd like to be first in line when the
    Growth Report opens, just reply to this email and say so.
  </p>`;

export function renderSnapshotEmailHtml(businessName: string, s: GrowthSnapshot): string {
  return `<div style="font-family:system-ui,sans-serif;max-width:640px;margin:0 auto;padding:8px">
    <h2 style="margin:16px 0 4px">Your DRDS Growth Snapshot</h2>
    <p style="color:#555;margin:0 0 16px">${esc(businessName)}</p>
    ${card("Primary Constraint", s.primaryConstraint)}
    ${card("What Is Going Well", s.whatIsGoingWell)}
    ${card("Why We Think This", s.whyWeThinkThis)}
    ${card("How Fixing It Will Help", s.howFixingItWillHelp)}
    ${card("Next Steps", s.nextSteps)}
    <p style="font-style:italic;color:#444;font-size:14px">${esc(s.confidencePlainLanguage)}</p>
    ${TIER_COPY}
    <p style="color:#999;font-size:12px;margin-top:24px">
      You received this one email because you asked us to send your Growth Snapshot.
      There is no mailing list and no account.
    </p>
  </div>`;
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
