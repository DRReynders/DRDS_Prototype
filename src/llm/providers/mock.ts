// Mock implementation of LlmProvider — structural testing ONLY.
//
// Exists so the pipeline's plumbing (contract ordering, object shapes, logging,
// escalation cap) can be exercised without API credits. Every value it returns
// is prefixed "[MOCK]" so its output can never be mistaken for real reasoning —
// canned output masquerading as a genuine Snapshot would violate the one
// non-negotiable of this project. It is selected ONLY by explicit
// DRDS_LLM_PROVIDER=mock, never as an automatic fallback.

import type { LlmProvider, LlmResult, ModelTier } from "../provider.js";

export class MockProvider implements LlmProvider {
  readonly name = "mock";

  async complete(prompt: string, _tier: ModelTier): Promise<LlmResult> {
    // Zero tokens, zero cost — recorded as such so mock runs are visibly free.
    return { text: this.answer(prompt), model: "mock", inputTokens: 0, outputTokens: 0 };
  }

  private answer(prompt: string): string {
    // Identify which pipeline prompt this is via distinctive markers in the
    // prompt templates, and return structurally valid JSON for it.
    if (prompt.includes("Client Identification Packet (CIP) for the business")) {
      return JSON.stringify({
        businessName: "[MOCK] Business",
        businessType: "Other",
        primaryDigitalAsset: "[MOCK] site",
        detectedDigitalAssets: [],
        location: "[MOCK] location",
        observedLanguages: ["English"],
        identificationConfidence: "Low",
        identityConflicts: [],
        notes: "[MOCK] Structural test output — no real identification performed.",
        cannotIdentify: false,
      });
    }
    if (prompt.includes("inferring a business's goal and relevant Growth Functions")) {
      return JSON.stringify({
        businessGoal: "[MOCK] Structural test goal — no real inference performed.",
        expectedGrowthFunctions: ["Credibility", "Discoverability"],
        growthFunctionRationale: "[MOCK]",
        goalModelConfidence: "Low",
        reasoningBasis: "[MOCK] Mock provider active.",
        cannotInfer: false,
      });
    }
    if (prompt.includes("performing evidence checks against genuinely fetched website content")) {
      const ids = [...prompt.matchAll(/^- ((?:E|ESC)-[A-Z]*-?\d+):/gm)].map((m) => m[1]);
      return JSON.stringify({
        results: ids.map((evidenceId) => ({
          evidenceId,
          evidenceValue: "[MOCK] Not genuinely checked — mock provider active.",
          resultStatus: "Not Assessed",
          observation: "[MOCK] Structural test only.",
        })),
      });
    }
    if (prompt.includes("Constraint-Driven")) {
      return JSON.stringify({
        primaryConstraint: "[MOCK] Structural test constraint — no real reasoning performed.",
        hypothesisConfidence: "Low",
        supportingEvidence: [],
        contradictoryEvidence: [],
        secondaryConstraints: [],
        reasoningNotes: "[MOCK] Mock provider active.",
        escalation: { wanted: false, evidenceSought: "", likelyToHelp: "[MOCK]" },
      });
    }
    if (prompt.includes("single smallest piece of additional publicly observable evidence")) {
      return JSON.stringify({
        worthAttempting: false,
        evidenceSought: "",
        urlToFetch: "",
        reasoning: "[MOCK] Mock provider never escalates.",
      });
    }
    if (prompt.includes("five-card Growth Snapshot")) {
      return JSON.stringify({
        primaryConstraint: "[MOCK] Not a real finding.",
        whatIsGoingWell: "[MOCK] Not a real finding.",
        whyWeThinkThis: "[MOCK] Not a real finding.",
        howFixingItWillHelp: "[MOCK] Not a real finding.",
        nextSteps: "[MOCK] Not a real finding.",
        confidencePlainLanguage: "[MOCK] This is structural test output, not a real analysis.",
      });
    }
    throw new Error("MockProvider received an unrecognised prompt — add a marker for it.");
  }
}
