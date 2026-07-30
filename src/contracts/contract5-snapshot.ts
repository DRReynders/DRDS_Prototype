// Contract 5 — Growth Snapshot.
// Promise: consistent quality + honest confidence, always produced once a
// ReasoningResult exists — never withheld for low confidence. Reasoning Notes
// are internal/audit-only and are deliberately excluded from what this stage
// ever sees, so they cannot leak into customer-facing copy.

import { llmJson, loadPrompt } from "../llm/client.js";
import type { GrowthSnapshot, ReasoningResult } from "../types.js";

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

// Fixed public copy. Deliberately generic: when nothing could be confirmed, a
// calm honest non-answer is the correct output, and fixed wording is something
// Product Council can review verbatim before it ever reaches a stranger.
// No numbers, no internal vocabulary, no claim about the business.
export function buildUnconfirmedSnapshot(): GrowthSnapshot {
  return {
    primaryConstraint:
      "We could not confirm enough from your published pages to name your biggest growth constraint yet. " +
      "What we saw needs a short visual check before we would state it as a finding.",
    whatIsGoingWell:
      "Your site was reachable and our review was able to read your main pages without difficulty.",
    whyWeThinkThis:
      "Parts of your site show information that only appears once the page is fully open, which an automated review cannot read reliably.",
    howFixingItWillHelp:
      "A short manual look at those pages would confirm what is actually there, so anything you act on reflects what visitors really see.",
    nextSteps: "Save or email this snapshot. A strategy call lets us confirm this properly with you.",
    confidencePlainLanguage:
      "We are not confident enough to call this a finding — it needs a person to look before we would stand behind it.",
    verificationRequired: true,
  };
}

export async function runContract5(rr: ReasoningResult): Promise<GrowthSnapshot> {
  // Gated constraints never reach the copywriter. Returning before the model
  // call is the guarantee: there is no prompt path that can restate the claim.
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
  return llmJson<GrowthSnapshot>(loadPrompt("snapshot-copywriting", { REASONING_RESULT: rendered }), {
    stage: "Contract 5",
    promptName: "snapshot-copywriting",
    tier: "reasoning",
  });
}
