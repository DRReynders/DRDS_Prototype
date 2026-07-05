// Smoke test for the non-LLM stages only (no API key needed):
// Contract 0 (normalise + real reachability), site corpus collection, and the
// mechanical evidence checks. Verifies real HTTP behaviour end to end.

import { runContract0 } from "../src/contracts/contract0-input.js";
import {
  checkCorePageCoverage,
  checkH1s,
  checkMetaDescriptions,
  checkSsl,
  checkTitles,
  gbpChecks,
} from "../src/evidence/checks.js";
import { collectSiteCorpus, allPages } from "../src/site.js";

const url = process.argv[2] ?? "https://www.southwood.co.za";

console.log(`--- Contract 0: ${url}`);
const c0 = await runContract0(url);
console.log(JSON.stringify(c0.input, null, 2));
if (!c0.homepage) process.exit(2);

console.log(`\n--- Site corpus`);
const corpus = await collectSiteCorpus(c0.homepage);
console.log(`robots.txt disallows: ${JSON.stringify(corpus.robotsDisallows)}`);
console.log(`robots-blocked candidates: ${corpus.robotsBlockedUrls.length}`);
console.log(`pages fetched OK: ${allPages(corpus).map((p) => `${p.finalUrl} [${p.status}]`).join(", ")}`);
console.log(`unfetched candidates: ${corpus.unfetchedCandidates.length}`);

console.log(`\n--- Mechanical evidence checks`);
for (const e of [
  checkSsl(corpus),
  checkTitles(corpus),
  checkMetaDescriptions(corpus),
  checkH1s(corpus),
  checkCorePageCoverage(corpus),
  ...gbpChecks(),
]) {
  console.log(`${e.evidenceId} [${e.resultStatus}] ${e.evidenceValue}`);
}
