// A4 — Growth Report Assembly Skeleton (Sprint 3 Stage A).
// Takes a stored run log and emits a DRAFT Growth Report as markdown,
// following DRDS_Growth_Report_Template_001.md: fixed copy filled in,
// pipeline-derived fields resolved, founder-judgement sections scaffolded
// with [FOUNDER — …] instructions. The output is NEVER client-facing as
// generated — it exists so founder time goes to judgement, not formatting.
//
// Standalone dev tool; type-only imports from src/ (erased at runtime).
// No pipeline module is imported or executed; Contracts 0–5 untouched.
//
// Usage:
//   npm run report:assemble -- runs/<runlog>.json [-o draft.md]

import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import type { EvidenceEntry, RunLog } from "../src/types.js";
import { buildEvidenceRegister } from "./evidence-appendix.js";

const F = (note: string): string => `> [FOUNDER — ${note}]`;
const WRITE_HERE = "✍ _(write here)_";

function questionOrFallback(e: EvidenceEntry): string {
  // Reuse the appendix's phrasing indirectly: growthFunction/type fallback.
  return e.evidenceValue;
}

function assemble(log: RunLog, sourceFile: string): string {
  const cip = log.cip;
  const gm = log.goalModel;
  const rr = log.reasoningResult;
  const snap = log.growthSnapshot;
  const entries = log.evidencePackage?.entries ?? [];

  const missing: string[] = [];
  if (!cip) missing.push("Contract 1 (CIP)");
  if (!gm) missing.push("Contract 2 (Goal Model)");
  if (!rr) missing.push("Contract 4 (Reasoning)");
  if (missing.length) {
    throw new Error(
      `Run log is missing ${missing.join(", ")} — a Growth Report draft needs a completed run. Choose a successful run log.`
    );
  }

  const name = cip!.businessName || "(business name unresolved)";
  const passes = entries.filter((e) => e.resultStatus === "Pass");
  const flagged = entries.filter((e) =>
    ["Not Assessed", "Indeterminate", "Partial"].includes(e.resultStatus)
  );
  const byId = new Map(entries.map((e) => [e.evidenceId, e]));

  const identityWarning = cip!.identityConflicts?.length
    ? [
        F(
          `⚠ The pipeline flagged identity conflicts — resolve with the client BEFORE writing further: ${cip!.identityConflicts
            .map((c) => `${c.field}: ${c.details}`)
            .join(" · ")}`
        ),
        "",
      ]
    : [];

  const secondaryScaffold = rr!.secondaryConstraints.length
    ? rr!.secondaryConstraints
        .map(
          (s) =>
            `- ${s}\n  ${F("Connected to the primary (state how), independent (say so), or noise (cut it)?")}`
        )
        .join("\n")
    : `_(The pipeline recorded no secondary constraints for this run.)_\n${F(
        "Either confirm the constraint genuinely stands alone — rare — or identify connected constraints the fixed check subset could not see. This section may not be skipped."
      )}`;

  const whatsWorkingDraft = passes.length
    ? passes
        .map((e) => `- **${e.growthFunction}** — ${questionOrFallback(e)} _(register: ${e.evidenceId})_`)
        .join("\n")
    : `_(No Pass-status evidence in this run — verify that is genuinely true before telling the client nothing is working.)_`;

  const supportingDraft = rr!.supportingEvidence.length
    ? rr!.supportingEvidence
        .map((ref) => {
          const e = byId.get(ref.evidenceId);
          const value = e ? ` — observed: ${e.evidenceValue}` : "";
          return `- **${ref.evidenceId}** — ${ref.why}${value}`;
        })
        .join("\n")
    : "_(No supporting evidence references recorded — investigate the run log before proceeding.)_";

  const contradictoryDraft = rr!.contradictoryEvidence.length
    ? rr!.contradictoryEvidence
        .map((ref) => {
          const e = byId.get(ref.evidenceId);
          const value = e ? ` — observed: ${e.evidenceValue}` : "";
          return `- **${ref.evidenceId}** — ${ref.why}${value}`;
        })
        .join("\n")
    : "We actively looked for evidence against this finding and did not find any — which is itself worth knowing.";

  const notAssessedDraft = flagged.length
    ? flagged
        .map(
          (e) =>
            `- **${e.growthFunction}** (${e.evidenceId}, ${e.resultStatus}) — ${e.observation} ${F(
              "one line: what access or evidence would close this gap"
            )}`
        )
        .join("\n")
    : "_(Every check in this run resolved cleanly — state the evidence boundary of the public-only method instead.)_";

  const snapshotReference = snap
    ? [
        F(
          "Reference only — what the FREE Snapshot already told this client. The Report must go meaningfully beyond it, and must not contradict it without explanation. Delete this block."
        ),
        "",
        `> _Snapshot said:_ ${snap.primaryConstraint}`,
        `> _Why:_ ${snap.whyWeThinkThis}`,
        `> _Confidence:_ ${snap.confidencePlainLanguage}`,
      ].join("\n")
    : F("No Snapshot copy in this run log. Delete this block.");

  const confidencePlain = snap?.confidencePlainLanguage
    ?? `(no snapshot in log — hypothesis confidence recorded as: ${rr!.hypothesisConfidence})`;

  return `<!-- DRAFT Growth Report — generated ${new Date().toISOString()} from ${sourceFile}.
     NOT client-facing until every [FOUNDER] note is resolved and the
     template QA checklist passes. Template: DRDS_Growth_Report_Template_001.md -->

<section class="cover">
<p class="kicker">GROWTH REPORT ────</p>

# ${name}

<p class="cover-meta">Prepared by DRDS — DR Digital Systems<br>
Date: {{DELIVERY_DATE}}<br>
Reference: ${log.runId}</p>
</section>

${snapshotReference}

---

## 1. How to read this report

This is a diagnosis and a sequence — not an audit, and not a to-do
list. It tells you what is limiting growth, what the evidence for that
is, what is genuinely working, and what order of action the system
demands. It deliberately does not include step-by-step implementation
instructions: those belong to whoever implements, once the sequence is
agreed.

Three sections matter most if you read nothing else: **The finding at
a glance** (next page), **The sequence** (§7), and **Where not to
spend money right now** (§5).

Everything this report claims is tied to an observation listed in the
Evidence Register at the back. Where our evidence could not see
something, we say so plainly in §9 rather than guessing.

---

## 2. The finding at a glance

**Primary constraint**

<p class="emphasis">${rr!.primaryConstraint}</p>

${F(
    "Pipeline text above is raw material. Rewrite in 1–2 owner-plain sentences. This page must survive being photographed and sent to a business partner with no context."
  )}

**The sequence, in one line**

${WRITE_HERE}

**How confident we are**

${confidencePlain}

${F("Plain language only — never a number or a grade. Restate for report depth if the Snapshot sentence is too thin.")}

---

## 3. Your business as we observed it

*Before any finding, it matters that we understood the right business.
This is what the evidence showed us — if anything here is wrong, tell
us: it is the foundation everything else stands on.*

- **Business:** ${name} — ${cip!.businessType}
- **Where you operate:** ${cip!.location || "(not observed)"}
- **Primary digital asset:** ${cip!.primaryDigitalAsset}
- **Other digital surfaces observed:** ${cip!.detectedDigitalAssets.join(", ") || "(none observed)"}
- **What the business appears built to achieve:** ${gm!.businessGoal}
- **Growth functions a business like this depends on:** ${gm!.expectedGrowthFunctions.join(", ")}

${identityWarning.join("\n")}${F(
    `Draft one short observed-narrative paragraph from the CIP. CIP notes for reference (delete): ${cip!.notes || "(none)"}`
  )}

${WRITE_HERE}

---

<div class="page-break"></div>

## 4. The constraint map

*Growth problems rarely travel alone. This section shows the primary
constraint and the secondary constraints connected to it — as one
system, because that is how they behave.*

**Primary constraint**

${WRITE_HERE} ${F("2–4 sentences: a system condition, not a missing feature — what it is, where it lives, what it starves.")}

**Connected constraints**

${secondaryScaffold}

**How they interact**

${WRITE_HERE} ${F(
    "The paragraph that earns the fee: what is upstream of what; what fixing the primary unlocks; what fixing the others first would waste."
  )}

---

## 5. What is genuinely working — and where not to spend right now

*An honest diagnosis includes what does not need money spent on it.*

**Working, with evidence**

${whatsWorkingDraft}

${F("Edit into narrated items: what works + why it matters. Genuine and specific; cut anything that reads as praise padding.")}

**Where not to spend money right now**

${WRITE_HERE} ${F(
    "2–4 items a vendor would happily sell this business that the sequence says should wait, one line each on why waiting is correct. Name activities, never specific vendors."
  )}

---

## 6. The evidence behind the finding

*We do not ask you to take the finding on faith. The full register of
every check is in the Appendix.*

**Supporting evidence**

${supportingDraft}

${F(
    "Edit for narrative, grouped by growth function: what/where/why-it-matters per load-bearing observation. Ceiling: 10–20 narrated items; the rest stay appendix-only."
  )}

**Evidence that points the other way**

${contradictoryDraft}

${F("Never delete this subsection — stating the against-case is a signature honesty move of this product.")}

---

<div class="page-break"></div>

## 7. The sequence

*Effort put into the wrong layer first is not partially wasted — it is
usually fully wasted, because the layer above undoes it. This is the
order the evidence supports, and why.*

**First — ${WRITE_HERE}**

- **Why first:** ${WRITE_HERE}
- **What it unlocks:** ${WRITE_HERE}
- **Definition of done:** ${WRITE_HERE} ${F("observable condition, not activity")}

**Second — ${WRITE_HERE}**

- **Why second / why not first:** ${WRITE_HERE}
- **What it unlocks:** ${WRITE_HERE}
- **Definition of done:** ${WRITE_HERE}

**Third — ${WRITE_HERE}**

- **Why third:** ${WRITE_HERE}
- **What it unlocks:** ${WRITE_HERE}
- **Definition of done:** ${WRITE_HERE}

${F("3–5 steps normal; every step must cite at least one register ID; delete unused step blocks.")}

**What deliberately waits — and why waiting is correct**

${WRITE_HERE}

---

## 8. The practitioner brief

*This section is written to be handed over. Give it to your website
person, your marketing partner, your internal team — or to DRDS. It
states objectives and what "done" looks like; it deliberately leaves
implementation method to the practitioner.*

<div class="brief-card">

**Brief item 1 — ${WRITE_HERE}**

- **Outcome required:** ${WRITE_HERE}
- **Done means:** ${WRITE_HERE}
- **Evidence reference:** ${WRITE_HERE}
- **Sequence position and dependency:** ${WRITE_HERE}

</div>

<div class="brief-card">

**Brief item 2 — ${WRITE_HERE}**

- **Outcome required:** ${WRITE_HERE}
- **Done means:** ${WRITE_HERE}
- **Evidence reference:** ${WRITE_HERE}
- **Sequence position and dependency:** ${WRITE_HERE}

</div>

${F(
    "One card per sequence step. A competent practitioner who has never spoken to DRDS must be able to act and know when they are finished. Respectful brief to a colleague — never a correction of past work."
  )}

---

## 9. Confidence and coverage — what we could and could not see

*This report works from publicly and organically observable evidence —
what the outside world can see of your business. That boundary is a
strength and a limit. Both deserve stating.*

<div class="confidence-block">

**Confidence**

${confidencePlain} ${WRITE_HERE} ${F("add 1–2 sentences: what would most efficiently confirm or revise the finding")}

**What this evidence could not assess**

${notAssessedDraft}

</div>

${F(
    "Must read as disclosure, never as a pitch. Product mentions live in §10 only. Check §9 names every Not Assessed row from the appendix."
  )}

---

## 10. Next steps

Your Report Walkthrough is included: a 30-minute call to walk the
finding and the sequence, answer questions, and make sure whoever
implements can run with the brief. Book it here: {{WALKTHROUGH_LINK}}

If, after the walkthrough, you want the finding deepened with evidence
only you can grant access to — your Google Business Profile,
analytics, or how enquiries are actually handled — ask about an
Evidence Review. And if what you want is the whole system diagnosed
and a sequenced implementation pathway with DRDS accountable for it,
that conversation is the Growth Blueprint. Both are optional; this
report is complete as it stands.

${WRITE_HERE} ${F("optional single engagement-specific line; no pressure language. Evidence Review sentence stays only while PC keeps it approved-for-later.")}

---

<div class="page-break"></div>

${buildEvidenceRegister(log)}

---

${F(
    "PRE-DELIVERY QA — run the full checklist in DRDS_Growth_Report_Template_001.md, including: every [FOUNDER] note deleted; every {{TOKEN}} resolved; exclusion sweep (no keyword lists, no how-to steps, no numeric promises, no hourly framing, no reasoningNotes); read aloud; overnight rule; export per design system. Delete this note last."
  )}
`;
}

// ---- CLI ----
function main(): void {
  const args = process.argv.slice(2);
  const inPath = args.find((a) => !a.startsWith("-"));
  if (!inPath) {
    console.error("Usage: npm run report:assemble -- runs/<runlog>.json [-o draft.md]");
    process.exit(1);
  }
  const oIdx = args.indexOf("-o");
  const outPath =
    oIdx >= 0 && args[oIdx + 1]
      ? args[oIdx + 1]
      : `report-draft-${basename(inPath).replace(/\.json$/i, "")}.md`;

  const log = JSON.parse(readFileSync(inPath, "utf8")) as RunLog;
  writeFileSync(outPath, assemble(log, basename(inPath)), "utf8");
  console.log(`Draft report written: ${outPath}`);
  console.log(`Next: founder completes every [FOUNDER]/✍ item, then: npm run report:render -- ${outPath}`);
}

if (process.argv[1] && /assemble-report\.(ts|js)$/.test(process.argv[1])) {
  main();
}
