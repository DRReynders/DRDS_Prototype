// Stage A deliverable G (support) — offline Snapshot prompt comparison.
// Replays a stored ReasoningResult (from a past run log) through a DRAFT
// copywriting prompt file and prints the resulting Snapshot JSON with a
// word count. Nothing is deployed: prompts/snapshot-copywriting.txt and
// Contract 5 are untouched; this tool renders the prompt itself from the
// draft file passed on the command line.
//
// Uses the existing LLM client (same budget guard + usage recording as
// any dev pipeline run). Costs one "reasoning"-tier call per invocation.
//
// Usage:
//   tsx tools/compare-snapshot-prompt.ts runs/<runlog>.json <draft-prompt.txt>

import { readFileSync } from "node:fs";
import { llmJson, loadEnv } from "../src/llm/client.js";
import type { GrowthSnapshot, RunLog } from "../src/types.js";

function renderReasoningResult(log: RunLog): string {
  const rr = log.reasoningResult;
  if (!rr) throw new Error("Run log has no reasoningResult — choose a completed run.");
  // Mirrors the rendering in src/contracts/contract5-snapshot.ts exactly
  // (duplicated here so the contract file itself is not imported/executed).
  return [
    `Business Goal: ${rr.businessGoal}`,
    `Expected Growth Functions: ${rr.expectedGrowthFunctions.join(", ")}`,
    `Primary Constraint: ${rr.primaryConstraint}`,
    `Hypothesis Confidence: ${rr.hypothesisConfidence}`,
    `Evidence Coverage: ${rr.evidenceCoverage}`,
    `Supporting Evidence:\n${rr.supportingEvidence.map((e) => `- ${e.evidenceId}: ${e.why}`).join("\n") || "- (none)"}`,
    `Contradictory Evidence:\n${rr.contradictoryEvidence.map((e) => `- ${e.evidenceId}: ${e.why}`).join("\n") || "- None found (checked)"}`,
    `Secondary Constraints: ${rr.secondaryConstraints.join("; ") || "None identified"}`,
  ].join("\n\n");
}

function words(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

async function main(): Promise<void> {
  const [logPath, promptPath] = process.argv.slice(2);
  if (!logPath || !promptPath) {
    console.error("Usage: tsx tools/compare-snapshot-prompt.ts runs/<runlog>.json <draft-prompt.txt>");
    process.exit(1);
  }
  loadEnv();

  const log = JSON.parse(readFileSync(logPath, "utf8")) as RunLog;
  const draft = readFileSync(promptPath, "utf8");
  const prompt = draft.replaceAll("{{REASONING_RESULT}}", renderReasoningResult(log));

  const snap = await llmJson<GrowthSnapshot>(prompt, {
    stage: "StageA offline comparison",
    promptName: "snapshot-copywriting-REVISED-DRAFT",
    tier: "reasoning",
  });

  const fields = Object.entries(snap) as [string, string][];
  const total = fields.reduce((n, [, v]) => n + words(String(v)), 0);

  console.log(JSON.stringify(snap, null, 2));
  console.log("---");
  for (const [k, v] of fields) console.log(`${k}: ${words(String(v))} words`);
  console.log(`TOTAL: ${total} words`);
}

main().catch((err) => {
  console.error("Comparison run failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
