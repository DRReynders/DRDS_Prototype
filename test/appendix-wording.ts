// N-1 regression guard: internal engineering vocabulary must never reach the
// client-facing evidence appendix. No network, no LLM calls, no cost.
// Run: npx tsx test/appendix-wording.ts [--print]

import { buildEvidenceRegister } from "../tools/evidence-appendix.js";
import { applyZeroAbsentSafetyRule } from "../src/evidence/checks.js";
import { EMPTY_DYNAMIC_SIGNALS, type EvidenceEntry, type RunLog } from "../src/types.js";

let failed = 0;
function check(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond || !detail ? "" : `  -> ${detail}`}`);
  if (!cond) failed++;
}

function entry(over: Partial<EvidenceEntry>): EvidenceEntry {
  return {
    evidenceId: "E-CON-018",
    growthFunction: "Credibility / Persuasion",
    evidenceType: "Observation",
    evidenceValue: "No case studies or before/after visual proof of results are present in the fetched content.",
    resultStatus: "Fail",
    source: "Direct fetch",
    evidenceAccessibility: "Publicly Observable",
    observation: "Assessed from the fetched page text.",
    ...over,
  };
}

// A package shaped exactly like a real post-Phase-1 run: one downgraded item,
// one escalation item, one clean item.
const signals = { ...EMPTY_DYNAMIC_SIGNALS, counters: 15, lazyImages: 21, galleries: 2 };
const entries: EvidenceEntry[] = [
  applyZeroAbsentSafetyRule(entry({}), signals),
  applyZeroAbsentSafetyRule(
    entry({
      evidenceId: "ESC-001",
      growthFunction: "(escalation)",
      evidenceValue: "Case study cards show '0' for every metric.",
      resultStatus: "Partial",
      observation: "Gathered during an additional evidence pass.",
    }),
    signals
  ),
  entry({
    evidenceId: "E-CON-017",
    growthFunction: "Credibility",
    evidenceValue: "Testimonials present from Chris, Evelyn and Niall.",
    resultStatus: "Pass",
    observation: "Read directly from the page.",
  }),
  entry({
    evidenceId: "E-VIS-018",
    growthFunction: "Discoverability",
    evidenceValue: "No method available to confirm Google Business Profile status in this run",
    resultStatus: "Not Assessed",
    source: "N/A",
    observation:
      "Direct-fetch-only run mode: Google Business Profile surfaces cannot be retrieved without a search/places API. Absence of confirmation is not confirmed absence.",
  }),
];

const log = {
  runId: "test",
  startedAt: new Date().toISOString(),
  input: { inputType: "Website URL", rawInputValue: "x", normalisedBusinessIdentifier: "x", normalisationStatus: "Success", normalisationNotes: "" },
  pagesFetched: [],
  stages: [],
  evidencePackage: { entries, evidenceCoverage: "Substantial — 3 of 4 evidence items could actually be assessed." },
} as unknown as RunLog;

const output = buildEvidenceRegister(log);

if (process.argv.includes("--print")) {
  console.log("\n----- RENDERED APPENDIX -----\n");
  console.log(output);
  console.log("\n----- END -----\n");
}

console.log("=== Forbidden internal vocabulary must be absent ===");
const FORBIDDEN = [
  "static fetch",
  "static markup",
  "JavaScript",
  "dynamicSignals",
  "counters:",
  "lazyImages",
  "galleries:",
  "Downgraded from",
  "(escalation)",
  "Direct fetch",
  "Direct-fetch",
  "Example H1s",
];
for (const term of FORBIDDEN) {
  const present = output.toLowerCase().includes(term.toLowerCase());
  check(`absent: "${term}"`, !present, present ? "FOUND in appendix output" : "");
}
check('column header "Band" replaced', !/\|\s*Band\s*\|/.test(output));

console.log("\n=== Client-safe phrasing must be present ===");
check("not-confirmed note present", /Could not be confirmed from the published page/i.test(output));
check("separate visual verification named", /requires separate visual verification/i.test(output));
check("escalation relabelled", /Additional evidence/i.test(output));
check("Availability column present", /\|\s*Availability\s*\|/.test(output));

console.log("\n=== Substance preserved ===");
check("original observation text kept", /No case studies or before\/after visual proof/i.test(output));
check("clean entries untouched", /Testimonials present from Chris, Evelyn and Niall/.test(output));
check("Indeterminate status still shown", /Indeterminate/.test(output));
// Only the prose lines — stripping table pipes would create spurious doubles.
const proseLines = output.split("\n").filter((l) => l.startsWith("- ") || l.startsWith("**"));
check("no double spaces in prose lines", !proseLines.some((l) => / {2,}/.test(l)), proseLines.find((l) => / {2,}/.test(l)) ?? "");
check("no orphaned lowercase sentence starts", !proseLines.some((l) => /\.\s+[a-z]/.test(l)), proseLines.find((l) => /\.\s+[a-z]/.test(l)) ?? "");

console.log(`\n${failed === 0 ? "ALL PASSED" : `${failed} CHECK(S) FAILED`}`);
process.exit(failed === 0 ? 0 : 1);
