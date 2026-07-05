// Unit check for the cost estimator and budget guard (no network, no key).
// Run: npx tsx test/budget-check.ts

import {
  assertWithinBudget,
  beginUsageCollection,
  BudgetExceededError,
  collectUsage,
  estimateCostUsd,
  recordCall,
} from "../src/llm/usage.js";

let failed = 0;
function check(name: string, cond: boolean): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}`);
  if (!cond) failed++;
}

// Price estimation
check("haiku pricing", estimateCostUsd("claude-haiku-4-5-20251001", 10_000, 2_000) === (10_000 * 1 + 2_000 * 5) / 1e6);
check("sonnet pricing", estimateCostUsd("claude-sonnet-5", 10_000, 2_000) === (10_000 * 3 + 2_000 * 15) / 1e6);
check("unknown model -> null", estimateCostUsd("some-future-model", 1_000, 1_000) === null);
check("mock -> zero", estimateCostUsd("mock", 1_000, 1_000) === 0);

// Budget guard
process.env.MAX_RUN_COST_USD = "0.10";
beginUsageCollection();
assertWithinBudget(); // nothing spent yet — must not throw
recordCall({
  stage: "t", promptName: "t", provider: "anthropic", model: "claude-sonnet-5",
  inputTokens: 20_000, outputTokens: 3_000, totalTokens: 23_000,
  estimatedCostUsd: 0.105, costBasis: "estimated-from-price-table",
  durationMs: 1, status: "success",
});
let threw = false;
try {
  assertWithinBudget();
} catch (e) {
  threw = e instanceof BudgetExceededError;
}
check("guard triggers at/over limit", threw);

// No limit configured -> never triggers
process.env.MAX_RUN_COST_USD = "";
assertWithinBudget();
check("no limit -> no trigger", true);

// Totals + breakdown
const u = collectUsage();
check("totals: 1 call", u.totals.llmCalls === 1);
check("totals: cost summed", u.totals.estimatedCostUsd === 0.105);
check("breakdown has model", u.modelBreakdown["claude-sonnet-5"]?.calls === 1);

process.exit(failed ? 1 : 0);
