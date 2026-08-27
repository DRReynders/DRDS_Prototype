// Patch 001.3 — Snapshot unsupported-claim guard tests.
// No network, no LLM calls, no cost. Run: npx tsx test/patch0013-snapshot-claims.ts
//
// Run 003 reached the right diagnosis and then told the owner:
//   "Your site is easy for patients to find online."
// Nothing in that run measured findability. The Discoverability checks that passed
// were on-page signals — meta descriptions, core page set, NAP consistency — while
// all three Google Business Profile items sat at Not Assessed. Manual checking
// happens to show iSmile ranks #1 locally, so the sentence was probably true. Being
// accidentally right on evidence you do not have is the failure this whole rehearsal
// exists to stamp out, and unlike the earlier ones this sentence reaches a client.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildUnconfirmedSnapshot } from "../src/contracts/contract5-snapshot.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const prompt = readFileSync(join(ROOT, "prompts/snapshot-copywriting.txt"), "utf8");
const flat = prompt.replace(/\s+/g, " ");

let failed = 0;
function check(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond || !detail ? "" : `  -> ${detail}`}`);
  if (!cond) failed++;
}

console.log("=== 1. Outcome claims are forbidden unless measured ===");
check("guard section exists", /Evidence boundary/.test(prompt));
check("states the run does not measure results", /It does not measure results/.test(flat));
check("conditions the ban on an evidence item having measured it", /Unless an evidence item\s*actually measured it/.test(flat) || /Unless an evidence item actually measured it/.test(flat));
for (const term of ["search rankings", "local pack", "Google Business Profile", "impressions", "traffic", "clicks"]) {
  check(`names the off-limits metric: ${term}`, flat.includes(term));
}
check("covers how easily customers actually find them", /how easily customers actually find them/.test(flat));

console.log("\n=== 2. On-page discoverability is distinguished from findability ===");
check("states on-page signals are not findability", /On-page signals are not findability/.test(prompt));
check("names the on-page signals explicitly", /Titles, headings, meta descriptions/.test(flat));
check("draws the BUILT vs PERFORMS distinction", /how the site is\s*BUILT, not how it PERFORMS/.test(flat) || /BUILT, not how it PERFORMS/.test(flat));
check("forbids upgrading structure into being-found", /Never upgrade an observation of structure into a claim about being found/.test(flat));

console.log("\n=== 3. The exact Run 003 phrasing is blocked, with safe alternatives offered ===");
for (const banned of [
  "Easy to find online",
  "you rank well",
  "Google surfaces you clearly",
  "your local visibility is strong",
  "customers can find you easily",
]) {
  check(`blocked example present: "${banned}"`, flat.includes(banned));
}
check("paraphrases are blocked too", /every paraphrase of them\s*— are forbidden/.test(flat) || /and every paraphrase of them/.test(flat));
check("ban holds regardless of on-page scores", /no matter how well the on-page checks scored/.test(flat));
for (const safe of [
  "Your main pages are reachable and your service structure is visible.",
  "Your site gives visitors a clear route into your services.",
  "Your public pages are structured well enough to follow the journey.",
]) {
  check(`safe alternative offered: "${safe.slice(0, 40)}…"`, flat.includes(safe));
}

console.log("\n=== 4. Unassessed areas may not be reported as strengths ===");
check("names the unassessed case", /Where local search, rankings or Google Business Profile were not assessed/.test(flat));
check("offers leave-alone or name-as-unchecked", /leave the topic alone or name it as not yet checked/.test(flat));
check("forbids framing it as a strength", /never as a strength/.test(flat));
check("states an unmeasured area is not good news", /An\s*unmeasured area is not good news/.test(flat) || /unmeasured area is not good news/.test(flat));

console.log("\n=== 5. Applies to all cards, hardest to What Is Going Well ===");
check("explicitly all cards", /This holds for every card/.test(flat));
check("singles out What Is Going Well", /hardest for "What Is Going Well"/.test(flat));
check("names the reassurance pull", /the pull to\s*reassure is strongest/.test(flat) || /pull to reassure is strongest/.test(flat));
check("prefers smaller true praise", /praise something smaller and true/.test(flat));

console.log("\n=== 6. Word caps and anti-bloat preserved ===");
check("constrains wording not length", /It constrains WORDING, not length/.test(flat));
check("word caps still stand", /every word cap\s*above still applies/.test(flat) || /every word cap above still applies/.test(flat));
check("forbids buying room with a caveat", /must not add a caveat sentence to buy yourself room/.test(flat));
check("original per-card caps intact", /Maximum 32 words/.test(prompt) && (prompt.match(/Maximum 24 words/g) ?? []).length >= 4 && /Maximum 16 words/.test(prompt));
check("150-word total cap intact", /150 words total/.test(prompt));
check("two-pass compression instruction intact", /PASS 1 \(draft\)/.test(prompt) && /PASS 2 \(compress\)/.test(prompt));

console.log("\n=== 7. Earlier guards still present ===");
check("C2 regulator guard intact", /If the Regulator-Sensitive Context above marks this business regulator-sensitive/.test(prompt));
check("C2 placeholder intact", prompt.includes("{{REGULATOR_CONTEXT}}"));
check("C2 General escape intact", /says General, ignore this paragraph entirely/.test(flat));
check("reasoning-result placeholder intact", prompt.includes("{{REASONING_RESULT}}"));
check("no-prescription rule intact", /the Snapshot diagnoses;\s*it never prescribes/.test(flat) || /it never prescribes/.test(flat));
check("bundling rule intact", /Never bundle two deficiencies into one sentence/.test(prompt));
check("value ladder rule intact", /Value ladder rule/.test(prompt));
check("output format unchanged", /"whatIsGoingWell": "\.\.\."/.test(prompt));

console.log("\n=== 8. Gated Snapshot copy still passes the guard ===");
// Re-anchored by the observation-boundary pass: this copy is now internal and
// was reworded to drop its "name it as your main constraint" promise. The
// unmeasured-outcome guard below is unchanged and still applies to it.
const snap = buildUnconfirmedSnapshot();
check("gated copy still leads with the review having happened", snap.primaryConstraint.startsWith("We reviewed your public pages"));
check("gated copy promises no constraint", !/constraint/i.test(Object.values(snap).filter((v) => typeof v === "string").join(" ")));
check("verificationRequired still set", snap.verificationRequired === true);
const gatedText = Object.values(snap).filter((v) => typeof v === "string").join(" ").toLowerCase();
const FORBIDDEN = [
  "easy to find", "find you", "rank", "ranking", "local pack", "google", "search engine",
  "visibility", "impressions", "traffic", "discoverable", "found online",
];
for (const term of FORBIDDEN) {
  check(`gated copy free of "${term}"`, !gatedText.includes(term), gatedText.slice(0, 120));
}
const gatedWords = gatedText.split(/\s+/).filter(Boolean).length;
check("gated copy still under the 150-word ceiling", gatedWords <= 150, String(gatedWords));

console.log("\n=== 9. Guard is general, not iSmile-specific ===");
check("no client name in the prompt", !/ismile/i.test(prompt));
check("no dental or sector-specific wording in the guard", !/dental|dentist|patient/i.test(prompt.split("Evidence boundary")[1]?.split("The Snapshot is a trailer")[0] ?? ""));
check("uses 'customers', not a sector noun", /customers actually find them/.test(flat));

console.log(`\n${failed === 0 ? "ALL PASSED" : `${failed} CHECK(S) FAILED`}`);
process.exit(failed === 0 ? 0 : 1);
