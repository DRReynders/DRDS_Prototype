// Contract 2 — Goal Model.
// Promise: the same CIP always produces the same inference, or reports that it
// cannot infer with adequate confidence. Per the Confidence Escalation Principle,
// this stage NEVER seeks additional evidence to resolve its own uncertainty — low
// confidence travels forward structurally.

import { llmJson, loadPrompt } from "../llm/client.js";
import type { ClientIdentificationPacket, Confidence, GoalModel } from "../types.js";

interface GoalModelLlmResponse {
  businessGoal: string;
  expectedGrowthFunctions: string[];
  growthFunctionRationale: string;
  goalModelConfidence: Confidence;
  reasoningBasis: string;
  cannotInfer: boolean;
}

export async function runContract2(cip: ClientIdentificationPacket): Promise<GoalModel> {
  const cipText = [
    `Business Name: ${cip.businessName}`,
    `Business Type: ${cip.businessType}`,
    `Primary Digital Asset: ${cip.primaryDigitalAsset}`,
    `Location: ${cip.location}`,
    `Detected Digital Assets: ${cip.detectedDigitalAssets.join(", ") || "None detected"}`,
    `Observed Languages: ${cip.observedLanguages.join(", ")}`,
    `Identification Confidence: ${cip.identificationConfidence}`,
    cip.identityConflicts.length
      ? `Identity Conflicts: ${cip.identityConflicts.map((c) => `${c.field} — ${c.details}`).join("; ")}`
      : `Identity Conflicts: none found`,
    `Notes: ${cip.notes}`,
  ].join("\n");

  // "reasoning" tier: goal inference is the highest-risk judgment in the
  // architecture — it gets the stronger configured model.
  const res = await llmJson<GoalModelLlmResponse>(loadPrompt("goal-model", { CIP: cipText }), {
    stage: "Contract 2",
    promptName: "goal-model",
    tier: "reasoning",
  });

  if (res.cannotInfer) {
    // "Cannot infer with adequate confidence" is a valid, promised outcome — it is
    // reported honestly as a Low-confidence GoalModel, and travels forward. The
    // pipeline does not halt here; that decision belongs to Contract 4.
    return {
      businessGoal: "Could not be inferred with adequate confidence",
      expectedGrowthFunctions: res.expectedGrowthFunctions ?? [],
      goalModelConfidence: "Low",
      reasoningBasis: res.reasoningBasis,
    };
  }

  return {
    businessGoal: res.businessGoal,
    expectedGrowthFunctions: res.expectedGrowthFunctions,
    goalModelConfidence: res.goalModelConfidence,
    reasoningBasis: [res.reasoningBasis, res.growthFunctionRationale]
      .filter(Boolean)
      .join(" Growth Functions: "),
  };
}
