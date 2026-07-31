// Contract 5 — Growth Snapshot.
// Promise: consistent quality + honest confidence, always produced once a
// ReasoningResult exists — never withheld for low confidence. Reasoning Notes
// are internal/audit-only and are deliberately excluded from what this stage
// ever sees, so they cannot leak into customer-facing copy.

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

// Fixed public copy for the gated case. Reviewed wording, not model output, so
// Product Council can read verbatim what a stranger will see.
//
// It leads with the review having happened. Someone who waited two minutes must
// not feel nothing occurred — the work was done, and the honest result is that
// one area cannot be responsibly named without a look at the live page. This is
// a held position, not a failure, and the copy should read that way.
//
// No numbers, no internal vocabulary, no claim about the business, nothing
// asserted that has not been verified. Card lengths follow the v1.3 caps
// (32/24/24/24/24/16); total sits under the 150-word Snapshot ceiling.
export function buildUnconfirmedSnapshot(): GrowthSnapshot {
  return {
    primaryConstraint:
      "We reviewed your public pages and gathered enough to see how your business presents itself. " +
      "One key area still needs visual confirmation before we would responsibly name it as your main constraint.",
    whatIsGoingWell:
      "Your site is reachable, your main pages read clearly, and the way you describe your business came through without difficulty.",
    whyWeThinkThis:
      "Some of what matters most only appears once a page is fully open, so we could not confirm it from the published version alone.",
    howFixingItWillHelp:
      "A short visual check would let us name your constraint with confidence, so what you act on reflects what visitors actually see.",
    nextSteps:
      "Save or email this snapshot. A strategy call is the quickest way for us to confirm this properly and give you the finding.",
    confidencePlainLanguage:
      "We would rather flag this for a closer look than name something we cannot stand behind.",
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
