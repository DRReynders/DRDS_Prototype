// Token/cost tracking and the soft budget guard. One collector per run —
// safe as module state because the pipeline processes one run at a time,
// which is an enforced property of this prototype, not an accident.

export interface LlmCallRecord {
  stage: string;
  promptName: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number | null; // null when no pricing is known for the model
  costBasis: "estimated-from-price-table" | "unknown-model-pricing" | "mock-zero-cost";
  durationMs: number;
  status: "success" | "failure";
  error?: string;
}

export interface LlmUsageSummary {
  calls: LlmCallRecord[];
  totals: {
    llmCalls: number;
    failedCalls: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedCostUsd: number; // sum of known-price calls only
    callsWithUnknownPricing: number;
  };
  modelBreakdown: Record<
    string,
    { calls: number; inputTokens: number; outputTokens: number; estimatedCostUsd: number }
  >;
  costNote: string;
}

// USD per million tokens, matched by substring on the model id. All costs are
// ESTIMATES computed from this table — vendor SDK responses report tokens, not
// prices. Update alongside vendor pricing pages.
const PRICE_TABLE: { match: string; inputPerMTok: number; outputPerMTok: number }[] = [
  { match: "haiku", inputPerMTok: 1, outputPerMTok: 5 },
  { match: "sonnet", inputPerMTok: 3, outputPerMTok: 15 },
  { match: "opus", inputPerMTok: 15, outputPerMTok: 75 },
];

export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number | null {
  if (model === "mock") return 0;
  const p = PRICE_TABLE.find((row) => model.toLowerCase().includes(row.match));
  if (!p) return null;
  return (inputTokens * p.inputPerMTok + outputTokens * p.outputPerMTok) / 1_000_000;
}

export class BudgetExceededError extends Error {
  constructor(spentUsd: number, limitUsd: number) {
    super(
      `Run stopped by the cost budget guard: estimated spend so far is ` +
        `$${spentUsd.toFixed(4)}, which has reached the configured soft limit ` +
        `MAX_RUN_COST_USD=${limitUsd}. No further LLM calls were made. ` +
        `Raise the limit in .env if this run should be allowed to cost more.`
    );
  }
}

let calls: LlmCallRecord[] = [];

export function beginUsageCollection(): void {
  calls = [];
}

export function recordCall(record: LlmCallRecord): void {
  calls.push(record);
}

function spentUsd(): number {
  return calls.reduce((sum, c) => sum + (c.estimatedCostUsd ?? 0), 0);
}

// Soft limit: checked BEFORE each new call, so a single in-flight call may
// overshoot slightly — that is what "soft" means here, stated honestly.
export function assertWithinBudget(): void {
  const limit = Number(process.env.MAX_RUN_COST_USD || 0);
  if (!limit || limit <= 0) return; // no limit configured
  const spent = spentUsd();
  if (spent >= limit) throw new BudgetExceededError(spent, limit);
}

export function collectUsage(): LlmUsageSummary {
  const totals = {
    llmCalls: calls.length,
    failedCalls: calls.filter((c) => c.status === "failure").length,
    inputTokens: calls.reduce((s, c) => s + c.inputTokens, 0),
    outputTokens: calls.reduce((s, c) => s + c.outputTokens, 0),
    totalTokens: calls.reduce((s, c) => s + c.totalTokens, 0),
    estimatedCostUsd: Number(spentUsd().toFixed(6)),
    callsWithUnknownPricing: calls.filter((c) => c.estimatedCostUsd === null).length,
  };
  const modelBreakdown: LlmUsageSummary["modelBreakdown"] = {};
  for (const c of calls) {
    const m = (modelBreakdown[c.model] ??= { calls: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 });
    m.calls += 1;
    m.inputTokens += c.inputTokens;
    m.outputTokens += c.outputTokens;
    m.estimatedCostUsd = Number((m.estimatedCostUsd + (c.estimatedCostUsd ?? 0)).toFixed(6));
  }
  return {
    calls,
    totals,
    modelBreakdown,
    costNote:
      "All costs are estimates from a static price table (USD per million tokens) — the vendor SDK reports token counts, not prices." +
      (totals.callsWithUnknownPricing > 0
        ? ` ${totals.callsWithUnknownPricing} call(s) used a model with no table entry; their cost is excluded from the total.`
        : ""),
  };
}
