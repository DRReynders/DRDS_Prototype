// Build Order step 2: run the pipeline against the three businesses already
// validated on paper (Validation Exercises 001-003) so output can be compared
// against the paper results. Requires ANTHROPIC_API_KEY in .env.
// Runs sequentially, one at a time — deliberately no concurrency.

import { runPipeline } from "../src/pipeline.js";

const BUSINESSES = [
  { name: "Southwood Financial Planning (Ex. 001)", url: "https://www.southwood.co.za" },
  { name: "Zeelie Professional Accountants SA (Ex. 002)", url: "https://www.zeeliepasa.co.za" },
  { name: "GKC Attorneys (Ex. 003)", url: "https://gkcattorneys.co.za" },
];

for (const b of BUSINESSES) {
  console.log(`\n########## ${b.name} — ${b.url} ##########`);
  const { log, logFile } = await runPipeline(b.url, (s) => console.error(`… ${s}`));
  if (log.failure) {
    console.log(`FAILED at ${log.failure.stage}: ${log.failure.reason}`);
  } else {
    console.log(`CIP: ${log.cip?.businessName} | ${log.cip?.businessType} | ${log.cip?.location} | ID confidence: ${log.cip?.identificationConfidence}`);
    console.log(`Identity conflicts: ${log.cip?.identityConflicts.length ? JSON.stringify(log.cip.identityConflicts) : "none found"}`);
    console.log(`Goal: ${log.goalModel?.businessGoal}`);
    console.log(`Growth Functions: ${log.goalModel?.expectedGrowthFunctions.join(", ")} (confidence: ${log.goalModel?.goalModelConfidence})`);
    console.log(`Evidence coverage: ${log.evidencePackage?.evidenceCoverage}`);
    for (const e of log.evidencePackage?.entries ?? []) {
      console.log(`  ${e.evidenceId} [${e.resultStatus}] ${e.evidenceValue.slice(0, 120)}`);
    }
    console.log(`Escalation: ${JSON.stringify(log.escalationTrace)}`);
    console.log(`PRIMARY CONSTRAINT (${log.reasoningResult?.hypothesisConfidence}): ${log.reasoningResult?.primaryConstraint}`);
    console.log(`Contradictory evidence: ${JSON.stringify(log.reasoningResult?.contradictoryEvidence)}`);
    console.log(`SNAPSHOT CONFIDENCE LINE: ${log.growthSnapshot?.confidencePlainLanguage}`);
  }
  console.log(`Run log: ${logFile}`);
}
