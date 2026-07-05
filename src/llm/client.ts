// LLM facade used by all four LLM stages (Contracts 1, 2, 4, 5).
// Vendor-neutral: the concrete provider is chosen here from configuration, and
// nothing outside src/llm/providers/ imports any vendor SDK. Keys come only
// from the environment (.env) — never from code.
//
// Every call passes through here, which is where usage recording and the
// budget guard live — Contracts declare a task tier and a prompt name, nothing
// about models or costs.

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { LlmNotConfiguredError, type LlmProvider, type ModelTier } from "./provider.js";
import { AnthropicProvider } from "./providers/anthropic.js";
import { MockProvider } from "./providers/mock.js";
import { assertWithinBudget, estimateCostUsd, recordCall } from "./usage.js";

const PROMPTS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "prompts");

// Minimal .env loader — avoids a dotenv dependency.
export function loadEnv(): void {
  try {
    const envPath = join(PROMPTS_DIR, "..", ".env");
    for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]] && m[2]) process.env[m[1]] = m[2];
    }
  } catch {
    /* no .env file — env vars may be set externally */
  }
}

let provider: LlmProvider | null = null;

export function getProvider(): LlmProvider {
  if (provider) return provider;
  const choice = (process.env.DRDS_LLM_PROVIDER || "anthropic").toLowerCase();
  switch (choice) {
    case "anthropic":
      provider = new AnthropicProvider(); // throws LlmNotConfiguredError if no key
      break;
    case "mock":
      // Explicit opt-in only — never an automatic fallback, so mock output can
      // never silently stand in for real reasoning.
      provider = new MockProvider();
      break;
    default:
      throw new LlmNotConfiguredError(`Unknown DRDS_LLM_PROVIDER "${choice}".`);
  }
  return provider;
}

export function loadPrompt(name: string, tokens: Record<string, string>): string {
  let prompt = readFileSync(join(PROMPTS_DIR, `${name}.txt`), "utf8");
  for (const [token, value] of Object.entries(tokens)) {
    prompt = prompt.replaceAll(`{{${token}}}`, value);
  }
  return prompt;
}

export interface LlmCallMeta {
  stage: string; // which Contract is calling
  promptName: string; // which prompts/*.txt file
  tier: ModelTier; // task kind — the provider maps this to a configured model
}

export async function llmJson<T>(prompt: string, meta: LlmCallMeta): Promise<T> {
  // One retry on malformed JSON only. Model formatting slips are transient and
  // would otherwise kill an entire run at its final stages; genuine request
  // failures still throw immediately. Both attempts are recorded and both pass
  // through the budget guard.
  try {
    return await llmJsonOnce<T>(prompt, meta);
  } catch (err) {
    const parseSlip =
      err instanceof SyntaxError || (err instanceof Error && err.message.startsWith("LLM did not return"));
    if (!parseSlip) throw err;
    return await llmJsonOnce<T>(prompt, meta);
  }
}

async function llmJsonOnce<T>(prompt: string, meta: LlmCallMeta): Promise<T> {
  const p = getProvider();
  assertWithinBudget(); // soft limit, checked before each new call
  const t0 = performance.now();
  try {
    const res = await p.complete(prompt, meta.tier);
    const estimatedCostUsd = estimateCostUsd(res.model, res.inputTokens, res.outputTokens);
    recordCall({
      stage: meta.stage,
      promptName: meta.promptName,
      provider: p.name,
      model: res.model,
      inputTokens: res.inputTokens,
      outputTokens: res.outputTokens,
      totalTokens: res.inputTokens + res.outputTokens,
      estimatedCostUsd,
      costBasis:
        res.model === "mock"
          ? "mock-zero-cost"
          : estimatedCostUsd === null
            ? "unknown-model-pricing"
            : "estimated-from-price-table",
      durationMs: Math.round(performance.now() - t0),
      status: "success",
    });
    const match = res.text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error(`LLM did not return JSON. Raw response:\n${res.text}`);
    return JSON.parse(match[0]) as T;
  } catch (err) {
    // Failed calls are recorded too (token counts unknown -> zeros).
    if (!(err instanceof SyntaxError) && err instanceof Error && !err.message.startsWith("LLM did not return")) {
      recordCall({
        stage: meta.stage,
        promptName: meta.promptName,
        provider: p.name,
        model: "(request failed)",
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        estimatedCostUsd: null,
        costBasis: "unknown-model-pricing",
        durationMs: Math.round(performance.now() - t0),
        status: "failure",
        error: err.message,
      });
    }
    throw err;
  }
}
