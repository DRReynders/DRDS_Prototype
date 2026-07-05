// Anthropic implementation of LlmProvider. The only file in the project that
// imports the Anthropic SDK. Model names live in configuration, never in
// Contract logic.

import Anthropic from "@anthropic-ai/sdk";
import { LlmNotConfiguredError, type LlmProvider, type LlmResult, type ModelTier } from "../provider.js";

const DEFAULT_MODELS: Record<ModelTier, string> = {
  fast: "claude-haiku-4-5-20251001", // simple extraction / classification
  reasoning: "claude-sonnet-5", // Goal Model, CDER, Snapshot copywriting
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
      max_tokens: 4096,
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
