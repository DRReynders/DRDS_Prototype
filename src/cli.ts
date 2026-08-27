// CLI entry: npm run pipeline -- <business-url>
// The pipeline runnable with no web interface at all (Build Order step 1).

import { runPipeline } from "./pipeline.js";

const url = process.argv[2];
if (!url) {
  console.error("Usage: npm run pipeline -- <business-url>");
  process.exit(1);
}

const { log, logFile } = await runPipeline(url, (stage) => console.error(`… ${stage}`));

function printUsage(): void {
  const u = log.llmUsage;
  if (!u || u.totals.llmCalls === 0) return;
  console.error(
    `\nLLM usage: ${u.totals.llmCalls} calls (${u.totals.failedCalls} failed), ` +
      `${u.totals.inputTokens} in / ${u.totals.outputTokens} out tokens, ` +
      `estimated cost $${u.totals.estimatedCostUsd.toFixed(4)}`
  );
  for (const [model, m] of Object.entries(u.modelBreakdown)) {
    console.error(
      `  ${model}: ${m.calls} calls, ${m.inputTokens} in / ${m.outputTokens} out, ~$${m.estimatedCostUsd.toFixed(4)}`
    );
  }
  console.error(`  Note: ${u.costNote}`);
}

if (log.failure) {
  console.error(`\nRun ended at ${log.failure.stage}: ${log.failure.reason}`);
  printUsage();
  console.error(`Run log: ${logFile}`);
  process.exit(2);
}

// What a visitor actually receives. Printed first, and printed in full, so a
// developer running the pipeline sees the PUBLIC product before the internal
// one — the same order of importance the product now has.
const p = log.publicSnapshot!;
console.log(`\n================ GROWTH SNAPSHOT (PUBLIC) ================`);
console.log(`Business: ${log.cip?.businessName} (${log.input.normalisedBusinessIdentifier})\n`);
console.log(`${p.businessRead}\n`);
console.log(`WHAT WE CAN SEE`);
for (const x of p.whatWeCanSee) console.log(`  · ${x.statement}\n      why: ${x.proof}`);
if (!p.whatWeCanSee.length) console.log(`  (none)`);
console.log(`\nWHAT IS WORKING`);
for (const x of p.whatIsWorking) console.log(`  · ${x.statement}\n      why: ${x.proof}`);
if (!p.whatIsWorking.length) console.log(`  (none)`);
console.log(`\nWHAT WE COULD NOT SETTLE`);
for (const x of p.whatWeCouldNotSettle) console.log(`  · ${x.question}\n      because: ${x.reason}`);
if (!p.whatWeCouldNotSettle.length) console.log(`  (none)`);
console.log(`\nCONFIDENCE IN THIS EVIDENCE\n  ${p.evidenceConfidence}`);
console.log(`\nEVIDENCE RECEIPT`);
console.log(`  ${p.evidenceReceipt.pagesInspectedCount} page(s) read; ${p.evidenceReceipt.signalsSettled} of ${p.evidenceReceipt.signalsChecked} checks settled.`);
for (const u of p.evidenceReceipt.pagesInspected) console.log(`  - ${u}`);
for (const l of p.evidenceReceipt.limitations) console.log(`  ! ${l}`);
console.log(`\n${p.boundaryNote}`);
console.log(`==========================================================`);

// The internal hypothesis. Retained for the Growth Report and for evaluation;
// never shown to a visitor by any surface. Labelled here so a developer reading
// CLI output can never mistake it for the free product.
const s = log.growthSnapshot;
if (s) {
  console.log(`\n--------- INTERNAL ONLY — NOT PUBLIC, NOT FREE -----------`);
  console.log(`Primary Constraint (hypothesis, ${log.reasoningResult?.hypothesisConfidence}): ${s.primaryConstraint}`);
  console.log(`Secondary: ${log.reasoningResult?.secondaryConstraints.join("; ") || "none"}`);
  console.log(`Growth Report raw material. Never rendered to a stranger.`);
  console.log(`----------------------------------------------------------`);
}

// Stage 1.1: the visitor's product survived, so this run exits 0 and prints a
// Snapshot. A developer must still be told the reasoning did not complete, or
// the CLI would quietly present a run that cannot become a Growth Report as if
// it were a normal success.
if (log.internalFailure) {
  console.error(`\n!! INTERNAL REASONING DID NOT COMPLETE`);
  console.error(`   Failed at: ${log.internalFailure.stage}`);
  console.error(`   Reason:    ${log.internalFailure.reason}`);
  console.error(`   The public Growth Snapshot above is complete and was delivered.`);
  console.error(`   This run has no Growth Report raw material and cannot be assembled.`);
}
printUsage();
console.error(`\nRun log: ${logFile}`);
