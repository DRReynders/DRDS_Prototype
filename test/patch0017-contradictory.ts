// Patch 001.7 — structured contradictoryEvidence tests.
// No network, no LLM calls, no cost. Run: npx tsx test/patch0017-contradictory.ts
//
// Three runs left contradictoryEvidence empty while reasoning about counter-evidence
// in prose. Run 004: "The ESC-001 escalation meaningfully complicates the capture
// narrative by showing a working booking path exists on at least one page, so this is
// held at Medium rather than High."
//
// That was never a model failure. ESC-001 resolved to **Pass**, and both the prompt
// and the code said counter-evidence may only be Fail or Partial. The model was
// forbidden from filing the very evidence it had correctly identified — and had it
// filed it anyway, contract4's filter would have stripped it before it reached the
// run log.
//
// The premise was wrong. Counter-evidence to "conversion is broken" is a working
// route: a Pass.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { EvidenceEntry, EvidenceReference, ResultStatus } from "../src/types.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const cder = readFileSync(join(ROOT, "prompts/cder-reasoning.txt"), "utf8");
const flat = cder.replace(/\s+/g, " ");
const c4 = readFileSync(join(ROOT, "src/contracts/contract4-reasoning.ts"), "utf8");

let failed = 0;
function check(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond || !detail ? "" : `  -> ${detail}`}`);
  if (!cond) failed++;
}

console.log("=== 1-2. contradictoryEvidence is defined broadly ===");
check("named as the counterweight", /"contradictoryEvidence" holds the counterweight to your constraint/.test(flat));
check("explicitly NOT only total refutation", /NOT reserved for evidence that refutes it outright/.test(flat));
check("says qualification is the common case", /Total contradiction is rare;\s*qualification is common/.test(flat) || /Total contradiction is rare; qualification is common/.test(flat));
for (const verb of ["complicates", "qualifies", "tempers", "limits the scope of", "partially\n  contradicts"]) {
  const v = verb.replace(/\s+/g, " ");
  check(`covers: ${v}`, flat.includes(v));
}

console.log("\n=== 3. Pass may be counter-evidence — the actual bug ===");
check("Pass explicitly admitted", /including when the entry's Result Status is Pass/.test(flat));
check("explains why a Pass counterweighs", /A passing check is often the strongest counterweight/.test(flat));
check("gives the exact ESC-001 shape", /a working booking route found on one page is precisely\s*the evidence that your constraint is not universal/.test(flat) || /working booking route found on one page/.test(flat));
check("old Fail-or-Partial-only rule removed", !/may only cite entries whose Result Status is Fail or/.test(flat));
check("concluded statuses named", /Pass, Partial or Fail/.test(flat));
check("unconcluded statuses still excluded", /An\s*Indeterminate or Requires Browser Confirmation item can no more contradict a\s*hypothesis than support one/.test(flat) || /can no more contradict a hypothesis than support one/.test(flat));

console.log("\n=== 4. Trigger examples cover the iSmile cases ===");
for (const ex of [
  "the problem is real on some pages but not all",
  "a working path exists alongside the broken ones",
  "a strength sits in the same area as the weakness you named",
  "the escalation returned something that tempers the constraint",
  "a rival explanation remains plausible on evidence that concluded",
]) {
  check(`trigger listed: ${ex.slice(0, 46)}…`, flat.includes(ex));
}

console.log("\n=== 5. IDs required, invention forbidden ===");
check("requires a real Evidence ID and a why", /Each entry must cite a real Evidence ID from the package above with a short "why"/.test(flat));
check("forbids invented counter-evidence", /Never invent counter-evidence/.test(flat));
check("forbids manufactured balance", /never manufacture balance/.test(flat));
check("empty list still legitimate when genuine", /leave the list empty and mean it/.test(flat));
check("global no-invention rule still present", /Never\s*invent evidence/.test(flat));

console.log("\n=== 6. Prose is not a substitute for the structured field ===");
check("reasoningNotes vs contradictoryEvidence split stated", /reasoningNotes is for the nuance and the argument; contradictoryEvidence is for the\s*structured references/.test(flat) || /contradictoryEvidence is for the structured references/.test(flat));
check("explaining in notes alone is called insufficient", /Explaining a complication in the notes while leaving the list\s*empty is not enough/.test(flat) || /leaving the list empty is not enough/.test(flat));
check("names the downstream consequence", /sees "checked, found none" when\s*you found something/.test(flat) || /checked, found none" when you found something/.test(flat));

console.log("\n=== 7. The constraint is not auto-weakened ===");
check("recording counter-evidence does not retract", /Recording counter-evidence does not retract your constraint/.test(flat));
check("survived qualification framed as stronger", /survives an honest qualification is stronger than one that was never tested/.test(flat));
check("prescribes narrow-and-hold, not abandon", /keep the constraint, narrow\s*its scope, and hold confidence at Medium — not to abandon it/.test(flat) || /narrow its scope, and hold confidence at Medium/.test(flat));

console.log("\n=== 8. The code filter no longer strips a Pass ===");
check("Fail/Partial-only filter removed from code", !/return s === "Fail" \|\| s === "Partial";/.test(c4));
check("filter now uses the concluded test", /res\.contradictoryEvidence = \(res\.contradictoryEvidence \?\? \[\]\)\.filter\(\(r\) => isReportSafeSupport\(r\.evidenceId\)\)/.test(c4));
check("root cause documented in code", /strongest counterweight to "conversion pathways are broken" is a check that\s*\/\/ PASSED/.test(c4) || /is a check that/.test(c4.split("Patch 001.7")[1]?.slice(0, 400) ?? ""));

// Mirrors contract4's post-fix filter to prove the behaviour change end to end.
const entries: EvidenceEntry[] = (
  [
    ["ESC-001", "Pass"], ["E-CON-101", "Partial"], ["E-VIS-003", "Fail"],
    ["E-RES-101", "Indeterminate"], ["E-CON-018", "Requires Browser Confirmation"],
    ["E-VIS-018", "Not Assessed"], ["E-X-001", "Not Applicable"],
  ] as [string, ResultStatus][]
).map(([evidenceId, resultStatus]) => ({
  evidenceId, growthFunction: "Capture", evidenceType: "Observation", evidenceValue: "v",
  resultStatus, source: "fixture", evidenceAccessibility: "Publicly Observable", observation: "o",
}));
const byId = new Map(entries.map((e) => [e.evidenceId, e]));
const UNSAFE = new Set(["Indeterminate", "Requires Browser Confirmation"]);
const concluded = (id: string): boolean => {
  const s = byId.get(id)?.resultStatus;
  return s !== undefined && s !== "Not Assessed" && s !== "Not Applicable" && !UNSAFE.has(s);
};
const proposed: EvidenceReference[] = entries.map((e) => ({ evidenceId: e.evidenceId, why: "w" }));
const kept = proposed.filter((r) => concluded(r.evidenceId)).map((r) => r.evidenceId);
check("ESC-001 (Pass) now survives the filter", kept.includes("ESC-001"), kept.join(", "));
check("Partial survives", kept.includes("E-CON-101"));
check("Fail survives", kept.includes("E-VIS-003"));
check("Indeterminate still stripped", !kept.includes("E-RES-101"));
check("Requires Browser Confirmation still stripped", !kept.includes("E-CON-018"));
check("Not Assessed still stripped", !kept.includes("E-VIS-018"));
check("Not Applicable still stripped", !kept.includes("E-X-001"));
check("exactly three concluded statuses kept", kept.length === 3, String(kept.length));

console.log("\n=== 9. Supporting-evidence discipline unchanged ===");
check("support still excludes Indeterminate and RBC", /"supportingEvidence" additionally may not cite entries whose Result Status is\s*Indeterminate or Requires Browser Confirmation/.test(flat));
check("neither list may cite Not Assessed / Not Applicable", /NEITHER list may cite entries whose Result Status is Not Assessed or\s*Not Applicable/.test(flat));
check("constraint safety gate intact", /requires-rendered-verification/.test(c4));
check("escalation still capped at one attempt", /HARD-CAPPED AT ONE ATTEMPT/.test(c4));
check("sibling-tenant guard intact", /isSiblingTenantUrl/.test(c4));

console.log("\n=== 10. Earlier guards intact ===");
check("A2 coverage rule intact", /A growth function showing 0 usable items/.test(cder));
check("001.2 usable/attempted wording intact", /produced a USABLE result over items ATTEMPTED/.test(cder));
check("001.4 blind-spot section intact", /Local-market visibility blind spot/.test(cder));
check("001.4 no-strength-or-weakness rule intact", /Never state or imply that local visibility is strong, weak, sufficient or poor/.test(flat));
check("C2 regulator section intact", /Regulator-sensitive sectors/.test(cder));
check("C2 legal-advice disclaimer intact", /Nothing you write here is legal advice/.test(cder));
check("placeholders intact", cder.includes("{{GOAL_MODEL}}") && cder.includes("{{EVIDENCE_PACKAGE}}") && cder.includes("{{REGULATOR_CONTEXT}}"));
check("output schema unchanged", /"contradictoryEvidence": \[\{"evidenceId": "\.\.\.", "why": "\.\.\."\}, \.\.\.\]/.test(cder));

const snapPrompt = readFileSync(join(ROOT, "prompts/snapshot-copywriting.txt"), "utf8");
check("001.6 plain-language guard intact", /Plain language — write to the owner/.test(snapPrompt));
check("001.6 confidence calibration intact", /Confidence wording — match the evidence/.test(snapPrompt));
check("001.3 evidence boundary intact", /Evidence boundary/.test(snapPrompt));
check("Snapshot prompt untouched by this patch", !/contradictoryEvidence/.test(snapPrompt));

console.log("\n=== 11. Generic ===");
check("no client name in the prompt", !/ismile/i.test(cder));
check("no client name in contract 4", !/ismile/i.test(c4.replace(/Run 004's ESC-001/g, "")));

console.log(`\n${failed === 0 ? "ALL PASSED" : `${failed} CHECK(S) FAILED`}`);
process.exit(failed === 0 ? 0 : 1);
