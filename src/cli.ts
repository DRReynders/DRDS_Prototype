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

const s = log.growthSnapshot!;
console.log(`\n================ GROWTH SNAPSHOT ================`);
console.log(`Business: ${log.cip?.businessName} (${log.input.normalisedBusinessIdentifier})\n`);
console.log(`PRIMARY CONSTRAINT\n${s.primaryConstraint}\n`);
console.log(`WHAT IS GOING WELL\n${s.whatIsGoingWell}\n`);
console.log(`WHY WE THINK THIS\n${s.whyWeThinkThis}\n`);
console.log(`HOW FIXING IT WILL HELP\n${s.howFixingItWillHelp}\n`);
console.log(`NEXT STEPS\n${s.nextSteps}\n`);
console.log(`CONFIDENCE\n${s.confidencePlainLanguage}`);
console.log(`=================================================`);
printUsage();
console.error(`\nRun log: ${logFile}`);
