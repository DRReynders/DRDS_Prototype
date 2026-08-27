// Contract 5 — Growth Snapshot (INTERNAL since the observation-boundary pass).
//
// Promise unchanged: consistent quality + honest confidence, always produced
// once a ReasoningResult exists — never withheld for low confidence. Reasoning
// Notes are internal/audit-only and are deliberately excluded from what this
// stage ever sees.
//
// WHAT CHANGED: this is no longer the public contract. The free Growth Snapshot
// a visitor receives is built by src/projection/public-snapshot.ts from the
// evidence layer alone. This stage's output is retained because the Growth
// Report assembler reads it (tools/assemble-report.ts) and because run-history
// comparability matters — but it reaches the run log, not the browser, not the
// email, and not any other public surface.
//
// It states a Primary Constraint, so it is judgement, so it is not free.

import { llmJson, loadPrompt } from "../llm/client.js";
import { renderRegulatorContext } from "../types.js";
import type { ClientIdentificationPacket, GrowthSnapshot, ReasoningResult } from "../types.js";

// Phase 1.1 — Snapshot constraint safety display guard.
//
// Contract 4's safety gate can mark a Primary Constraint as unsupported: the
// evidence it rested on could not be confirmed from the published page. Phase 1
// withdrew that support and lowered confidence, but the constraint SENTENCE
// still reached this stage and was rendered to the visitor as established fact.
// A live run on 2026-07-30 showed a visitor being told every metric on their
// case-studies page displayed zero when the page in fact showed real figures.
//
// The fix is not to ask the copywriter to be careful with a false sentence — it
// is to never show it the sentence. When the constraint is gated, this stage
// emits fixed, reviewed copy and makes NO model call, so an unverified claim
// cannot reach the visitor by any path.
export function isConstraintGated(rr: ReasoningResult): boolean {
  return rr.constraintSafety?.status === "requires-rendered-verification";
}

// Fixed copy for the gated case. Reviewed wording, not model output.
//
// SCOPE CHANGE (observation-boundary pass): this is now INTERNAL copy. Since
// the public payload became src/projection/public-snapshot.ts, no visitor and
// no email reader ever sees these words — they reach the run log and the Growth
// Report assembler only.
//
// It was reworded anyway, because the previous version promised twice to "name
// it as your main constraint" and "name your constraint with confidence". Even
// held internally, copy that promises the judgement act is one refactor away
// from a public surface again, and the boundary should not depend on which
// renderer happens to read it today.
//
// It still leads with the review having happened, still asserts nothing about
// the business that was not verified, and still carries no numbers and no
// internal vocabulary. Card lengths follow the v1.3 caps (32/24/24/24/24/16);
// total sits under the 150-word ceiling.
export function buildUnconfirmedSnapshot(): GrowthSnapshot {
  return {
    primaryConstraint:
      "We reviewed your public pages and gathered enough to see how your business presents itself. " +
      "One area still needs a look at the live page before we would state anything about it.",
    whatIsGoingWell:
      "Your site is reachable, your main pages read clearly, and the way you describe your business came through without difficulty.",
    whyWeThinkThis:
      "Some of what a visitor sees only appears once a page is fully open, so the published version alone does not show it.",
    howFixingItWillHelp:
      "A short look at the live page would settle this, so what you act on reflects what visitors actually see.",
    nextSteps:
      "Save or email this snapshot. A strategy call is the quickest way for us to go through this with you.",
    confidencePlainLanguage:
      "We would rather flag this for a closer look than state something we cannot stand behind.",
    verificationRequired: true,
  };
}

export async function runContract5(
  rr: ReasoningResult,
  // Area C2: optional and read-only. Supplies sector/regulator-sensitivity so the
  // copywriter avoids casual marketing advice in restricted categories.
  cip?: ClientIdentificationPacket
): Promise<GrowthSnapshot> {
  // Gated constraints never reach the copywriter. Returning before the model
  // call is the guarantee: there is no prompt path that can restate the claim.
  // Area C2 changes nothing here — the fixed copy makes no claim and no model
  // call, so it is safe in any sector.
  if (isConstraintGated(rr)) return buildUnconfirmedSnapshot();

  const rendered = [
    `Business Goal: ${rr.businessGoal}`,
    `Expected Growth Functions: ${rr.expectedGrowthFunctions.join(", ")}`,
    `Primary Constraint: ${rr.primaryConstraint}`,
    `Hypothesis Confidence: ${rr.hypothesisConfidence}`,
    `Evidence Coverage: ${rr.evidenceCoverage}`,
    `Supporting Evidence:\n${rr.supportingEvidence.map((e) => `- ${e.evidenceId}: ${e.why}`).join("\n") || "- (none)"}`,
    `Contradictory Evidence:\n${rr.contradictoryEvidence.map((e) => `- ${e.evidenceId}: ${e.why}`).join("\n") || "- None found (checked)"}`,
    `Secondary Constraints: ${rr.secondaryConstraints.join("; ") || "None identified"}`,
    // reasoningNotes intentionally omitted — internal/audit-only per Contract 4.
  ].join("\n\n");

  // "reasoning" tier: the customer-facing wording is where honesty-of-
  // confidence and specificity live — it gets the stronger configured model.
  return llmJson<GrowthSnapshot>(
    loadPrompt("snapshot-copywriting", {
      REASONING_RESULT: rendered,
      REGULATOR_CONTEXT: renderRegulatorContext(cip),
    }),
    {
      stage: "Contract 5",
      promptName: "snapshot-copywriting",
      tier: "reasoning",
    }
  );
}
