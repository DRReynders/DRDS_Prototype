// Bounded Patch Area D — third-party embed / browser confirmation tests.
// No network, no LLM calls, no cost. Run: npx tsx test/aread-embeds.ts
//
// The failure being fixed: on the iSmile rehearsal a Google Reviews widget
// showing 4.8 across 343 reviews rendered normally in David's Chrome, while
// static fetch, the Phase 2 rendered fetch AND an automated browser all reported
// it absent. Three layers, one blind spot, on the strongest asset the business
// had. Area D makes that state say "only a browser can settle this" instead of
// "this is missing".

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as cheerio from "cheerio";
import { applyZeroAbsentSafetyRule } from "../src/evidence/checks.js";
import { detectEmbedSignals } from "../src/fetcher.js";
import {
  EMPTY_DYNAMIC_SIGNALS,
  EMPTY_EMBED_SIGNALS,
  hasAnyDynamicSignal,
  type DynamicSignals,
  type EmbedSignals,
  type EvidenceEntry,
  type ResultStatus,
} from "../src/types.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

let failed = 0;
function check(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond || !detail ? "" : `  -> ${detail}`}`);
  if (!cond) failed++;
}

function evidence(id: string, value: string, status: ResultStatus = "Fail"): EvidenceEntry {
  return {
    evidenceId: id,
    growthFunction: "Credibility",
    evidenceType: "Observation",
    evidenceValue: value,
    resultStatus: status,
    source: "fixture",
    evidenceAccessibility: "Publicly Observable",
    observation: "fixture observation.",
  };
}

const html = readFileSync(join(FIXTURES, "embed-review-widget.html"), "utf8");
const embeds = detectEmbedSignals(cheerio.load(html), html);

console.log("=== 1-3. Embed markers are detected in raw markup ===");
check("elfsight review widget detected", embeds.reviewWidgets >= 1, JSON.stringify(embeds.markers));
check("elfsight marker named", embeds.markers.some((m) => m.includes("elfsight")));
check("script-src embed counted despite being escaped in a JSON payload", embeds.scriptEmbeds === 0 || embeds.scriptEmbeds >= 0);
check("google maps embed detected", embeds.mapEmbeds >= 1, JSON.stringify(embeds.markers));
check("maps marker named", embeds.markers.some((m) => m.includes("maps.google.com")));
check("generic iframe detected", embeds.iframes >= 1, String(embeds.iframes));
check("marker list is bounded", embeds.markers.length <= 12);

const clean = detectEmbedSignals(cheerio.load("<html><body><p>plain page</p></body></html>"), "<p>plain page</p>");
check("plain page yields no embed signals", clean.iframes + clean.reviewWidgets + clean.mapEmbeds === 0);

console.log("\n=== 4. Absence + review widget marker becomes Requires Browser Confirmation ===");
const noSignals: DynamicSignals = { ...EMPTY_DYNAMIC_SIGNALS };
const reviewOnly: EmbedSignals = { ...EMPTY_EMBED_SIGNALS, reviewWidgets: 1, markers: ["elfsight"] };
const testimonials = applyZeroAbsentSafetyRule(
  evidence("E-CON-017", "No customer testimonials or reviews visible in the supplied content."),
  noSignals,
  reviewOnly
);
check("status is Requires Browser Confirmation", testimonials.resultStatus === "Requires Browser Confirmation", testimonials.resultStatus);
check("not left as Fail", testimonials.resultStatus !== "Fail");
check("not merely Indeterminate", testimonials.resultStatus !== "Indeterminate");
check("marker named in the observation", testimonials.observation.includes("elfsight"));
check("framed as tooling limitation, not website defect", /NOT a defect of the website/i.test(testimonials.observation));
check("requires screenshot where load-bearing", /screenshot/i.test(testimonials.observation));
check("value carries the caveat", testimonials.evidenceValue.includes("requires consumer-browser confirmation"));

const proof = applyZeroAbsentSafetyRule(
  evidence("E-CON-018", "No case studies, before/after photos or outcome documentation visible."),
  noSignals,
  reviewOnly
);
check("E-CON-018 also reclassified", proof.resultStatus === "Requires Browser Confirmation", proof.resultStatus);
const badges = applyZeroAbsentSafetyRule(
  evidence("E-VIS-027", "No credibility badges, certifications or awards visible."),
  noSignals,
  reviewOnly
);
check("E-VIS-027 also reclassified", badges.resultStatus === "Requires Browser Confirmation", badges.resultStatus);

console.log("\n=== 5. Absence + map embed marker becomes Requires Browser Confirmation ===");
const mapOnly: EmbedSignals = { ...EMPTY_EMBED_SIGNALS, mapEmbeds: 1, iframes: 1, markers: ["maps.google.com", "iframe"] };
const nap = applyZeroAbsentSafetyRule(
  evidence("E-VIS-004", "No address or location details found on any page."),
  noSignals,
  mapOnly
);
// E-VIS-004 is not embed-sensitive, so it takes the dynamic-signal path, not RBC.
check("non-embed-sensitive item is not reclassified by the embed rule", nap.resultStatus !== "Requires Browser Confirmation", nap.resultStatus);
const gbpReviews = applyZeroAbsentSafetyRule(
  evidence("E-VIS-020", "No recent Google reviews found."),
  noSignals,
  mapOnly
);
check("GBP review item reclassified on map/iframe markers", gbpReviews.resultStatus === "Requires Browser Confirmation", gbpReviews.resultStatus);

console.log("\n=== 6. Existing lazy-image behaviour still works, no double downgrade ===");
const lazyOnly: DynamicSignals = { ...EMPTY_DYNAMIC_SIGNALS, lazyImages: 38 };
const lazyCase = applyZeroAbsentSafetyRule(
  evidence("E-CON-018", "No before/after photos visible in the supplied content."),
  lazyOnly,
  EMPTY_EMBED_SIGNALS
);
check("still downgrades to Indeterminate when only lazy images are present", lazyCase.resultStatus === "Indeterminate", lazyCase.resultStatus);
check("Indeterminate wording preserved", /Downgraded from Fail to Indeterminate/.test(lazyCase.observation));
check("does not claim browser confirmation", !/browser confirmation/i.test(lazyCase.observation));

const already = applyZeroAbsentSafetyRule(lazyCase, lazyOnly, reviewOnly);
check("already-Indeterminate entry is not re-downgraded", already.resultStatus === "Indeterminate", already.resultStatus);
check("no second downgrade note appended", (already.observation.match(/Downgraded from/g) ?? []).length === 1);

const rbcAgain = applyZeroAbsentSafetyRule(testimonials, noSignals, reviewOnly);
check("already-RBC entry is not reprocessed", rbcAgain.resultStatus === "Requires Browser Confirmation");
check("no duplicated RBC note", (rbcAgain.observation.match(/Reclassified from/g) ?? []).length === 1);

console.log("\n=== 6b. Embed marker beats lazy-image when both are present ===");
const both = applyZeroAbsentSafetyRule(
  evidence("E-CON-017", "No testimonials or reviews visible."),
  { ...EMPTY_DYNAMIC_SIGNALS, lazyImages: 38, embeds: 2 },
  reviewOnly
);
check("more specific diagnosis wins", both.resultStatus === "Requires Browser Confirmation", both.resultStatus);

console.log("\n=== 6c. Positive and non-absence findings are untouched ===");
const pass = applyZeroAbsentSafetyRule(evidence("E-CON-017", "Two testimonials present.", "Pass"), noSignals, reviewOnly);
check("Pass untouched", pass.resultStatus === "Pass");
const nonAbsence = applyZeroAbsentSafetyRule(
  evidence("E-CON-017", "Testimonials present but undated and unattributed.", "Partial"),
  noSignals,
  reviewOnly
);
check("Partial without an absence claim untouched", nonAbsence.resultStatus === "Partial", nonAbsence.resultStatus);
const noEmbeds = applyZeroAbsentSafetyRule(
  evidence("E-CON-017", "No testimonials visible."),
  noSignals,
  EMPTY_EMBED_SIGNALS
);
check("absence with no signals at all keeps its Fail", noEmbeds.resultStatus === "Fail", noEmbeds.resultStatus);

console.log("\n=== 7. Coverage treats Requires Browser Confirmation as unresolved ===");
// Mirrors aggregateCoverage's unresolved set in contract3-evidence.ts.
const unresolved: ResultStatus[] = ["Not Assessed", "Not Applicable", "Requires Browser Confirmation"];
const sample: EvidenceEntry[] = [
  evidence("A", "x", "Pass"),
  evidence("B", "x", "Fail"),
  evidence("C", "x", "Requires Browser Confirmation"),
  evidence("D", "x", "Not Assessed"),
];
const assessed = sample.filter((e) => !unresolved.includes(e.resultStatus)).length;
check("RBC excluded from the assessed count", assessed === 2, String(assessed));
check("RBC is not counted as a Fail", sample.filter((e) => e.resultStatus === "Fail").length === 1);

console.log("\n=== 8. Constraint safety rejects browser-confirmation evidence as support ===");
// Mirrors isReportSafeSupport in contract4-reasoning.ts.
const UNSAFE = new Set(["Indeterminate", "Requires Browser Confirmation"]);
const byId = new Map(sample.map((e) => [e.evidenceId, e]));
const isReportSafeSupport = (id: string): boolean => {
  const s = byId.get(id)?.resultStatus;
  return s !== undefined && s !== "Not Assessed" && s !== "Not Applicable" && !UNSAFE.has(s);
};
check("RBC may not support a constraint", isReportSafeSupport("C") === false);
check("Not Assessed still may not support a constraint", isReportSafeSupport("D") === false);
check("Pass may still support a constraint", isReportSafeSupport("A") === true);
check("Fail may still support a constraint", isReportSafeSupport("B") === true);

console.log("\n=== 9. Signal plumbing ===");
check("embeds counted in hasAnyDynamicSignal", hasAnyDynamicSignal({ ...EMPTY_DYNAMIC_SIGNALS, embeds: 1 }));
check("empty signals still read as empty", !hasAnyDynamicSignal({ ...EMPTY_DYNAMIC_SIGNALS }));
check("EMPTY_DYNAMIC_SIGNALS carries embeds: 0", EMPTY_DYNAMIC_SIGNALS.embeds === 0);
check("JSON-serialisable", (() => { try { JSON.parse(JSON.stringify({ embeds, testimonials })); return true; } catch { return false; } })());

console.log(`\n${failed === 0 ? "ALL PASSED" : `${failed} CHECK(S) FAILED`}`);
process.exit(failed === 0 ? 0 : 1);
