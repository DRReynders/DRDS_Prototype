// Patch 001.6 — Snapshot plain-language and confidence-calibration tests.
// No network, no LLM calls, no cost. Run: npx tsx test/patch0016-snapshot-language.ts
//
// Run 004's "What Is Going Well" card read:
//   "Your main pages are reachable and your service structure is visible.
//    Discoverability checks returned usable results across all five pages assessed."
//
// The first sentence is right. The second is DRDS talking about DRDS: "Discoverability",
// "checks", "usable results", "assessed" are all internal evidence-layer terms, and
// "our checks ran successfully" is not a fact about the owner's business. It was a side
// effect of Patches 001.2 and 001.3 putting that vocabulary in front of the copywriter.
//
// Second issue, running since Run 001: the confidence line has said "fairly confident"
// on four consecutive Medium-confidence runs with partial coverage.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildUnconfirmedSnapshot } from "../src/contracts/contract5-snapshot.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const prompt = readFileSync(join(ROOT, "prompts/snapshot-copywriting.txt"), "utf8");
const flat = prompt.replace(/\s+/g, " ");
const plainSection = prompt.split("Plain language —")[1]?.split("Confidence wording —")[0] ?? "";
const confSection = prompt.split("Confidence wording —")[1]?.split("The Snapshot is a trailer")[0] ?? "";
const plainFlat = plainSection.replace(/\s+/g, " ");
const confFlat = confSection.replace(/\s+/g, " ");

let failed = 0;
function check(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond || !detail ? "" : `  -> ${detail}`}`);
  if (!cond) failed++;
}

console.log("=== 1. Internal vocabulary is banned from cards ===");
check("plain-language section exists", plainSection.length > 400, String(plainSection.length));
check("frames cards as about the business, not the method", /None of them describes\s*how the work was done/.test(plainFlat) || /None of them describes how the work was done/.test(plainFlat));
for (const term of [
  "evidence item", "checks", "assessed", "usable result", "coverage", "indeterminate",
  "unresolved", "requires browser confirmation", "growth function", "pipeline", "corpus",
  "contract", "run log", "static markup",
]) {
  check(`bans: ${term}`, plainFlat.includes(term));
}
check("bans Pass/Partial/Fail as result labels", /the\s*result labels Pass, Partial and Fail/.test(plainFlat) || /result labels Pass, Partial and Fail/.test(plainFlat));
check("bans the four growth-function names as formal labels", /Discoverability, Capture,\s*Response and Credibility used as formal category names/.test(plainFlat) || /Response and Credibility used as formal category names/.test(plainFlat));

console.log("\n=== 2. The exact Run 004 sentence is blocked ===");
check("quoted verbatim as a NO example", plainFlat.includes('"Discoverability checks returned usable results across all five pages assessed."'));
check("second bad example present", plainFlat.includes('"Capture was assessed across three evidence items."'));
check("third bad example present", plainFlat.includes('"Coverage was strong across the assessed pages."'));
check("names the failure mode directly", /If the only good news you can find is that our checks ran/.test(plainFlat));

console.log("\n=== 3. What Is Going Well must describe the business ===");
check("rule stated", /"What Is Going Well" must name something true about the business or its site/.test(plainFlat));
check("owner-recognisable test", /the\s*owner would recognise/.test(plainFlat) || /owner would recognise/.test(plainFlat));
check("explicitly never about our analysis", /never something true about our analysis/.test(plainFlat));
for (const good of [
  '"Your main pages are reachable and your service structure is visible."',
  '"Visitors can see your main services and contact routes from your public pages."',
  '"Your public pages give enough structure to follow the visitor journey."',
]) {
  check(`good example present: ${good.slice(0, 42)}…`, plainFlat.includes(good));
}

console.log("\n=== 4. Ordinary business language stays allowed ===");
for (const ok of ["visibility", "trust", "booking", "enquiry", "contact route", "service pages", "visitor journey", "website structure", "public pages"]) {
  check(`permits: ${ok}`, plainFlat.includes(ok));
}
check("states these are fine and often better", /Ordinary business words are fine and usually better/.test(plainFlat));
check("resolves the Next Steps 'evidence' collision", /holds the full detail or the full picture — not "the full evidence"/.test(plainFlat));

console.log("\n=== 5. Confidence calibration ===");
check("confidence section exists", confSection.length > 400, String(confSection.length));
check("says it is not a place to comfort", /It is not a place to comfort the\s*reader/.test(confFlat) || /not a place to comfort the reader/.test(confFlat));
check("names the warmer-adjective problem", /a warmer adjective than the evidence earns is a small lie/.test(confFlat));
for (const banned of ["fairly confident", "confident", "clear finding", "confirmed", "we can see clearly", "definitely", "certainly"]) {
  check(`blocks: ${banned}`, confFlat.includes(`"${banned}"`));
}
check("reserves those for High on concluded support", /belong to a High\s*confidence result resting on concluded support/.test(confFlat) || /High confidence result resting on concluded support/.test(confFlat));

console.log("\n=== 6. Calibration triggers cover the real signals ===");
for (const trigger of ["Medium or Low", "calls\n itself a hypothesis", "support is Partial", "awaiting browser confirmation", "not assessed"]) {
  const t = trigger.replace(/\s+/g, " ");
  check(`trigger present: ${t}`, confFlat.includes(t));
}
for (const safe of [
  '"This is a useful working hypothesis."',
  '"This points to a likely constraint, but it still needs confirming."',
  '"Your public pages point this way, though we could not confirm everything."',
]) {
  check(`calibrated alternative offered: ${safe.slice(0, 40)}…`, confFlat.includes(safe));
}
check("likely/points-to over confirmed for Partial", /Say "likely" or "points to" where the support is Partial\. Never "confirmed"/.test(confFlat));
check("calibration never softens naming the constraint", /never to how plainly we name the\s*constraint/.test(confFlat) || /never to how plainly we name the constraint/.test(confFlat));
check("directness still required", /Being direct about WHAT is limiting them is still required/.test(confFlat));

console.log("\n=== 7. Earlier Snapshot guards preserved ===");
check("001.3 evidence boundary intact", /Evidence boundary/.test(prompt));
check("001.3 'easy to find online' still blocked", /Easy to find online/.test(flat));
check("001.3 on-page vs findability intact", /On-page signals are not findability/.test(prompt));
check("001.3 unassessed-not-a-strength intact", /never as a strength/.test(flat));
check("C2 regulator guard intact", /If the Regulator-Sensitive Context above marks this business regulator-sensitive/.test(prompt));
check("C2 General escape intact", /says General, ignore this paragraph entirely/.test(flat));
check("placeholders intact", prompt.includes("{{REASONING_RESULT}}") && prompt.includes("{{REGULATOR_CONTEXT}}"));
check("no-prescription rule intact", /it never prescribes/.test(flat));
check("bundling rule intact", /Never bundle two deficiencies into one sentence/.test(prompt));
check("trailer-not-the-film framing intact", /The Snapshot is a trailer, not the film/.test(prompt));
check("output format unchanged", /"confidencePlainLanguage": "\.\.\."/.test(prompt));

console.log("\n=== 8. Word caps and anti-bloat preserved ===");
check("per-card caps intact", /Maximum 32 words/.test(prompt) && (prompt.match(/Maximum 24 words/g) ?? []).length >= 4 && /Maximum 16 words/.test(prompt));
check("150-word ceiling intact", /150 words total/.test(prompt));
check("two-pass compression intact", /PASS 1 \(draft\)/.test(prompt) && /PASS 2 \(compress\)/.test(prompt));
check("no caveat-sentence loophole introduced", /must not add a caveat sentence to buy yourself room/.test(flat));

console.log("\n=== 9. Gated Snapshot copy unchanged and compliant ===");
const snap = buildUnconfirmedSnapshot();
check("gated copy unchanged", snap.primaryConstraint.startsWith("We reviewed your public pages"));
check("verificationRequired still set", snap.verificationRequired === true);
const gated = Object.values(snap).filter((v) => typeof v === "string").join(" ").toLowerCase();
for (const term of ["evidence", "checks", "assessed", "usable", "coverage", "indeterminate", "pipeline", "corpus", "run log", "growth function"]) {
  check(`gated copy free of internal term "${term}"`, !gated.includes(term));
}
for (const term of ["fairly confident", "clear finding", "confirmed", "definitely", "certainly"]) {
  check(`gated copy free of overclaiming term "${term}"`, !gated.includes(term));
}
const words = gated.split(/\s+/).filter(Boolean).length;
check("gated copy under 150 words", words <= 150, String(words));

console.log("\n=== 10. Generic, prompt-only ===");
check("no client name in the prompt", !/ismile/i.test(prompt));
check("no sector-specific wording in the new sections", !/dental|dentist|patient/i.test(plainFlat + confFlat));
check("contract5 untouched by this patch", !/plain language|confidence wording/i.test(readFileSync(join(ROOT, "src/contracts/contract5-snapshot.ts"), "utf8")));

console.log(`\n${failed === 0 ? "ALL PASSED" : `${failed} CHECK(S) FAILED`}`);
process.exit(failed === 0 ? 0 : 1);
