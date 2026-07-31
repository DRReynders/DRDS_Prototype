// Phase 1.1 regression guard: a gated Primary Constraint must never be shown to
// a visitor as an established finding. No network, no LLM calls, no cost.
// Run: npx tsx test/phase11-snapshot-safety.ts [--print]

import { buildUnconfirmedSnapshot, isConstraintGated } from "../src/contracts/contract5-snapshot.js";
import type { GrowthSnapshot, ReasoningResult } from "../src/types.js";

let failed = 0;
function check(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond || !detail ? "" : `  -> ${detail}`}`);
  if (!cond) failed++;
}

function reasoning(over: Partial<ReasoningResult> = {}): ReasoningResult {
  return {
    businessGoal: "Win consulting engagements",
    expectedGrowthFunctions: ["Credibility", "Persuasion"],
    primaryConstraint:
      "The site's core proof-of-results mechanism — the case studies meant to substantiate claims of measurable impact — displays only zero-value placeholder metrics.",
    hypothesisConfidence: "Medium",
    evidenceCoverage: "Substantial",
    supportingEvidence: [{ evidenceId: "E-CON-018", why: "case study cards show 0" }],
    contradictoryEvidence: [],
    secondaryConstraints: ["Duplicate titles and only 2 of 5 core page types discoverable"],
    reasoningNotes: "internal",
    ...over,
  };
}

const GATED = reasoning({
  hypothesisConfidence: "Low",
  supportingEvidence: [],
  constraintSafety: {
    status: "requires-rendered-verification",
    reason: "2 of 3 evidence items were Indeterminate.",
    droppedSupportingEvidence: ["ESC-001", "E-CON-018"],
  },
});

const SAFE = reasoning();

console.log("=== Case 1: gated constraint is not presented as fact ===");
{
  check("gate detected", isConstraintGated(GATED));
  const snap = buildUnconfirmedSnapshot();
  if (process.argv.includes("--print")) {
    console.log("\n--- VISITOR-FACING COPY ---");
    for (const [k, v] of Object.entries(snap)) console.log(`  ${k}: ${v}`);
    console.log("---\n");
  }
  const all = Object.values(snap).filter((v) => typeof v === "string").join(" ");

  // The exact false claim from the 2026-07-30 live run must be impossible.
  check("no 'zero' metric claim", !/\bzero\b/i.test(all));
  check("no 'every metric' claim", !/every metric/i.test(all));
  check("no 'case stud' claim", !/case stud/i.test(all));
  check("no 'placeholder' claim", !/placeholder/i.test(all));
  check("original constraint text absent", !all.includes("proof-of-results"));

  // Copy polish: the visitor must be told the review HAPPENED before being told
  // what could not be concluded. Someone who waited two minutes should not feel
  // nothing occurred.
  check("leads with the review having happened", /^We reviewed your public pages/i.test(snap.primaryConstraint));
  check("credits what was gathered", /gathered enough/i.test(snap.primaryConstraint));
  check("names the limit as needing visual confirmation", /visual confirmation/i.test(snap.primaryConstraint));
  check("does not assert a finding", /before we would responsibly name it/i.test(snap.primaryConstraint));
  check("explains why, without blaming the site", /only appears once a page is fully open/i.test(snap.whyWeThinkThis));
  check("offers a concrete route forward", /strategy call/i.test(snap.nextSteps));
  check("confidence reads as a held position, not a failure", /rather flag this/i.test(snap.confidencePlainLanguage));
  check("does not sound like the system failed", !/(could not|unable|failed|error|sorry)/i.test(snap.primaryConstraint));
  check("flagged for internal observability", snap.verificationRequired === true);
}

console.log("\n=== Case 2: safe constraint still renders normally ===");
{
  check("gate NOT triggered on a safe result", !isConstraintGated(SAFE));
  check("gate NOT triggered when constraintSafety absent", !isConstraintGated(reasoning({ constraintSafety: undefined })));
  // Note: the model-written path cannot be exercised without a paid call. This
  // asserts the branch decision only; the LLM path is unchanged by Phase 1.1.
}

console.log("\n=== Case 3: no internal jargon in public copy ===");
{
  const snap = buildUnconfirmedSnapshot();
  const all = Object.values(snap).filter((v) => typeof v === "string").join(" ");
  const BANNED = [
    "static fetch", "JavaScript", "dynamicSignals", "Contract 4", "constraintSafety",
    "rendered verification", "Indeterminate", "gated", "support withdrawn",
    "evidence item", "pipeline", "HTML", "DOM", "fetch",
  ];
  for (const term of BANNED) {
    check(`absent: "${term}"`, !all.toLowerCase().includes(term.toLowerCase()));
  }
  check("no numbers or percentages in confidence copy", !/\d/.test(snap.confidencePlainLanguage));
}

console.log("\n=== Case 4: copy shape is sane ===");
{
  const snap: GrowthSnapshot = buildUnconfirmedSnapshot();
  const required: (keyof GrowthSnapshot)[] = [
    "primaryConstraint", "whatIsGoingWell", "whyWeThinkThis",
    "howFixingItWillHelp", "nextSteps", "confidencePlainLanguage",
  ];
  for (const f of required) {
    check(`${f} present and non-empty`, typeof snap[f] === "string" && String(snap[f]).trim().length > 20);
  }
  const words = Object.values(snap).filter((v) => typeof v === "string").join(" ").split(/\s+/).length;
  check(`total under the 150-word Snapshot cap (${words})`, words <= 150, `${words} words`);
}

console.log(`\n${failed === 0 ? "ALL PASSED" : `${failed} CHECK(S) FAILED`}`);
process.exit(failed === 0 ? 0 : 1);
