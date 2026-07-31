// Patch 001.2 — evidence coverage semantics tests.
// No network, no LLM calls, no cost. Run: npx tsx test/patch0012-coverage.ts
//
// The problem: Run 002 reported "Capture 3/3" while one of those three Capture
// items was Indeterminate — a check that ran and did not conclude. The arithmetic
// was right and the statement was misleading, because the numerator mixed
// "concluded" with "attempted".
//
// Coverage now separates three questions: what concluded (usable), what actually
// ran (attempted), and what is still open (unresolved). Indeterminate stays in
// the attempted count — pretending the check never ran would be its own
// dishonesty — but it may never inflate usable coverage.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { aggregateCoverage } from "../src/contracts/contract3-evidence.js";
import type { EvidenceEntry, ResultStatus } from "../src/types.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

let failed = 0;
function check(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond || !detail ? "" : `  -> ${detail}`}`);
  if (!cond) failed++;
}

let seq = 0;
function ev(fn: string, status: ResultStatus): EvidenceEntry {
  return {
    evidenceId: `E-${++seq}`, growthFunction: fn, evidenceType: "Observation",
    evidenceValue: "v", resultStatus: status, source: "fixture",
    evidenceAccessibility: "Publicly Observable", observation: "o",
  };
}
const usableNum = (s: string): number => Number(/— (\d+) of \d+ evidence items/.exec(s)?.[1] ?? -1);
const fnRatio = (s: string, fn: string): string => new RegExp(`${fn} (\\d+/\\d+)`).exec(s)?.[1] ?? "missing";

console.log("=== 1-3. Status policy: what counts as a usable result ===");
for (const s of ["Pass", "Partial", "Fail"] as ResultStatus[]) {
  check(`${s} counts as usable`, usableNum(aggregateCoverage([ev("Capture", s)])) === 1);
}
for (const s of ["Indeterminate", "Requires Browser Confirmation", "Not Assessed", "Not Applicable"] as ResultStatus[]) {
  check(`${s} does NOT count as usable`, usableNum(aggregateCoverage([ev("Capture", s)])) === 0);
}

console.log("\n=== 4. Indeterminate still counts as attempted ===");
const indet = aggregateCoverage([ev("Capture", "Indeterminate")]);
check("attempted denominator includes it", fnRatio(indet, "Capture") === "0/1", fnRatio(indet, "Capture"));
check("named in the unresolved breakdown", /1 indeterminate \(checked, did not conclude\)/.test(indet), indet);
const rbc = aggregateCoverage([ev("Credibility", "Requires Browser Confirmation")]);
check("Requires Browser Confirmation also counts as attempted", fnRatio(rbc, "Credibility") === "0/1");
check("browser-confirmation caveat preserved", /must not be reported as absent/.test(rbc));
const na = aggregateCoverage([ev("Discoverability", "Not Assessed")]);
check("Not Assessed is NOT attempted (no method existed)", fnRatio(na, "Discoverability") === "0/0", fnRatio(na, "Discoverability"));
check("Not Assessed explained", /no method available in this run/.test(na));

console.log("\n=== 5. The exact Run 002 Capture case ===");
// Run 002: E-CON-101 Indeterminate, E-CON-102 Partial, E-CON-103 Pass -> was "3/3".
const run002Capture = aggregateCoverage([
  ev("Capture", "Indeterminate"),
  ev("Capture", "Partial"),
  ev("Capture", "Pass"),
]);
check("Capture is now 2/3, not 3/3", fnRatio(run002Capture, "Capture") === "2/3", fnRatio(run002Capture, "Capture"));
check("the old inflated value is gone", !/Capture 3\/3/.test(run002Capture));

console.log("\n=== 6. A function with only Indeterminate evidence is not shown as covered ===");
const onlyIndet = aggregateCoverage([ev("Response", "Indeterminate"), ev("Response", "Indeterminate")]);
check("shows 0 usable", fnRatio(onlyIndet, "Response") === "0/2", fnRatio(onlyIndet, "Response"));
check("does not read as fully assessed", !/Response 2\/2/.test(onlyIndet));
const onlyRbc = aggregateCoverage([ev("Credibility", "Requires Browser Confirmation"), ev("Credibility", "Pass")]);
check("mixed RBC/Pass reads 1/2", fnRatio(onlyRbc, "Credibility") === "1/2", fnRatio(onlyRbc, "Credibility"));

console.log("\n=== 7. Headline wording and label thresholds ===");
const mixed = aggregateCoverage([
  ev("Capture", "Pass"), ev("Capture", "Partial"), ev("Capture", "Indeterminate"),
  ev("Credibility", "Requires Browser Confirmation"), ev("Credibility", "Fail"),
  ev("Discoverability", "Not Assessed"),
]);
console.log(`  -> ${mixed}`);
check("says 'produced a usable result'", /produced a usable result \(Pass, Partial or Fail\)/.test(mixed));
check("does not claim items were simply 'assessed'", !/could actually be assessed/.test(mixed));
check("usable count correct (3 of 6)", usableNum(mixed) === 3);
check("all three unresolved kinds named", /indeterminate/.test(mixed) && /consumer-browser/.test(mixed) && /not assessed/.test(mixed));
check("per-function header explains the ratio", /usable\/attempted/.test(mixed));
check("Thin label when usable is low", /^Thin —/.test(aggregateCoverage([ev("A", "Indeterminate"), ev("A", "Not Assessed"), ev("A", "Pass")])));
check("Substantial label when usable is high", /^Substantial —/.test(aggregateCoverage([ev("A", "Pass"), ev("A", "Pass"), ev("A", "Fail"), ev("A", "Partial")])));
check("no unresolved section when everything concluded", !/Unresolved:/.test(aggregateCoverage([ev("A", "Pass")])));

console.log("\n=== 8. Composite labels and escalation entries ===");
const composite = aggregateCoverage([ev("Discoverability / Credibility", "Pass"), ev("(escalation)", "Fail")]);
check("composite counts toward both functions", fnRatio(composite, "Discoverability") === "1/1" && fnRatio(composite, "Credibility") === "1/1");
check("(escalation) excluded from the breakdown", !/\(escalation\)/.test(composite.split("By growth function")[1] ?? ""));
check("empty entry list does not throw", typeof aggregateCoverage([]) === "string");

console.log("\n=== 9. Reasoning prompt is aligned with the new wording ===");
const cder = readFileSync(join(ROOT, "prompts/cder-reasoning.txt"), "utf8");
check("prompt explains usable vs attempted", /produced a USABLE result over items ATTEMPTED/.test(cder));
check("prompt names the usable statuses", /Pass, Partial or Fail/.test(cder));
check("prompt explains attempted-but-not-usable", /counts as attempted but not\s*\n?\s*usable/.test(cder.replace(/\s+/g, " ")) || /attempted but not usable/.test(cder.replace(/\s+/g, " ")));
check("rule now keys on 0 usable, not 0 assessed", /A growth function showing 0 usable items/.test(cder));
check("rule covers both causes of 0 usable", /Either nothing was checked there, or every/.test(cder));
check("stale 'assessed evidence' phrasing removed from the availability bullet", /function with usable evidence stays fully available/.test(cder));
check("example ratio matches new semantics", /"Capture 2\/3, Credibility 1\/6"/.test(cder));

console.log("\n=== 10. Findings themselves are untouched ===");
const before = ev("Capture", "Indeterminate");
const snapshot = JSON.stringify(before);
aggregateCoverage([before]);
check("aggregateCoverage does not mutate entries", JSON.stringify(before) === snapshot);
check("no result status is rewritten", before.resultStatus === "Indeterminate");

console.log(`\n${failed === 0 ? "ALL PASSED" : `${failed} CHECK(S) FAILED`}`);
process.exit(failed === 0 ? 0 : 1);
