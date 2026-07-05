// Contract 5 — Growth Snapshot.
// Promise: consistent quality + honest confidence, always produced once a
// ReasoningResult exists — never withheld for low confidence. Reasoning Notes
// are internal/audit-only and are deliberately excluded from what this stage
// ever sees, so they cannot leak into customer-facing copy.

import { llmJson, loadPrompt } from "../llm/client.js";
import type { GrowthSnapshot, ReasoningResult } from "../types.js";

export async function runContract5(rr: ReasoningResult): Promise<GrowthSnapshot> {
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
