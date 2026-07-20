// Anthropic implementation of LlmProvider. The only file in the project that
// imports the Anthropic SDK. Model names live in configuration, never in
// Contract logic.

import Anthropic from "@anthropic-ai/sdk";
import { LlmNotConfiguredError, type LlmProvider, type LlmResult, type ModelTier } from "../provider.js";

const DEFAULT_MODELS: Record<ModelTier, string> = {
  fast: "claude-haiku-4-5-20251001", // simple extraction / classification
  reasoning: "claude-sonnet-5", // Goal Model, CDER, Snapshot copywriting
};

// Output ceiling per tier. "reasoning" calls (CDER, Snapshot copywriting) do
// substantial internal drafting/self-checking before the final answer — the
// Snapshot v1.2 verification pass (2026-07-20) observed reasoning-tier calls
// exhausting a 4096 ceiling mid-answer even though the finished JSON is short
// (well under the ~150-word Snapshot cap), reproducibly on at least one
// business. Doubled to give headroom without masking runaway generation.
// "fast" tier has shown no such failure; left unchanged.
const MAX_OUTPUT_TOKENS: Record<ModelTier, number> = {
  fast: 4096,
  reasoning: 8192,
};

export class AnthropicProvider implements LlmProvider {
  readonly name = "anthropic";
  private client: Anthropic;
  private models: Record<ModelTier, string>;

  constructor() {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new LlmNotConfiguredError("DRDS_LLM_PROVIDER is 'anthropic' but ANTHROPIC_API_KEY is not set.");
    }
    this.client = new Anthropic();
    // DRDS_MODEL (single override for both tiers) wins if set; otherwise the
    // per-tier variables; otherwise the defaults above.
    this.models = {
      fast: process.env.DRDS_MODEL || process.env.DRDS_MODEL_FAST || DEFAULT_MODELS.fast,
      reasoning: process.env.DRDS_MODEL || process.env.DRDS_MODEL_REASONING || DEFAULT_MODELS.reasoning,
    };
  }

  async complete(prompt: string, tier: ModelTier): Promise<LlmResult> {
    const model = this.models[tier];
    const res = await this.client.messages.create({
      model,
      max_tokens: MAX_OUTPUT_TOKENS[tier],
      messages: [{ role: "user", content: prompt }],
    });
    return {
      text: res.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join(""),
      model,
      inputTokens: res.usage.input_tokens,
      outputTokens: res.usage.output_tokens,
    };
  }
}
