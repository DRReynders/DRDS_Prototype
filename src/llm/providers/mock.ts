// Mock implementation of LlmProvider — structural testing ONLY.
//
// Exists so the pipeline's plumbing (contract ordering, object shapes, logging,
// escalation cap) can be exercised without API credits. Every value it returns
// is prefixed "[MOCK]" so its output can never be mistaken for real reasoning —
// canned output masquerading as a genuine Snapshot would violate the one
// non-negotiable of this project. It is selected ONLY by explicit
// DRDS_LLM_PROVIDER=mock, never as an automatic fallback.

import type { LlmProvider, LlmResult, ModelTier } from "../provider.js";

// Test seam: which prompt this is, by the same distinctive markers `answer()`
// matches on. Exported so a test can name a stage without duplicating the
// markers.
export const MOCK_PROMPT_MARKERS: Record<string, string> = {
  "cip-identification": "Client Identification Packet (CIP) for the business",
  "goal-model": "inferring a business's goal and relevant Growth Functions",
  "evidence-textual": "performing evidence checks against genuinely fetched website content",
  "cder-reasoning": "Constraint-Driven",
  "escalation-check": "single smallest piece of additional publicly observable evidence",
  "snapshot-copywriting": "five-card Growth Snapshot",
};

/** Which prompt this text is, or null if it matches none. */
export function mockPromptName(prompt: string): string | null {
  for (const [name, marker] of Object.entries(MOCK_PROMPT_MARKERS)) {
    if (prompt.includes(marker)) return name;
  }
  return null;
}

export class MockProvider implements LlmProvider {
  readonly name = "mock";

  async complete(prompt: string, _tier: ModelTier): Promise<LlmResult> {
    // TEST SEAM — failure injection.
    //
    // DRDS_MOCK_FAIL_PROMPT names one or more prompts (comma-separated) that
    // this provider should throw on instead of answering. It exists because the
    // pipeline's failure boundaries — which stage's collapse costs the visitor
    // their Growth Snapshot and which does not — are behaviour worth testing,
    // and there is no other way to make a stage fail without either paying a
    // provider or reaching the network.
    //
    // Safe by construction: the mock provider is selected ONLY by an explicit
    // DRDS_LLM_PROVIDER=mock and is never an automatic fallback, so nothing here
    // can influence a real run. The thrown error deliberately carries no
    // provider, key or host detail.
    const failing = (process.env.DRDS_MOCK_FAIL_PROMPT ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const name = mockPromptName(prompt);
    if (name && failing.includes(name)) {
      throw new Error(`[MOCK] Injected failure for prompt "${name}" (DRDS_MOCK_FAIL_PROMPT).`);
    }

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
