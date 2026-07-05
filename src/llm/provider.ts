// Provider-neutral LLM interface. The pipeline depends only on this contract —
// never on a specific vendor. Swapping providers is a config change plus one
// implementation file; no Contract logic changes.

// Task-level routing: Contracts declare WHAT KIND of task a call is, never a
// model name. Which concrete model serves each tier is configuration
// (.env: DRDS_MODEL_FAST / DRDS_MODEL_REASONING), resolved inside the provider.
export type ModelTier = "fast" | "reasoning";

export interface LlmResult {
  text: string;
  model: string; // the concrete model that actually served the call
  inputTokens: number;
  outputTokens: number;
}

export interface LlmProvider {
  /** Human-readable name, recorded in run logs / errors. */
  readonly name: string;
  /** Send one prompt at the given tier, return text + token usage. */
  complete(prompt: string, tier: ModelTier): Promise<LlmResult>;
}

export class LlmNotConfiguredError extends Error {
  constructor(detail: string) {
    super(
      `No usable LLM provider is configured: ${detail} ` +
        `Set DRDS_LLM_PROVIDER and the provider's key in .env (see .env.example), ` +
        `or set DRDS_LLM_PROVIDER=mock for structural testing without API access.`
    );
  }
}
