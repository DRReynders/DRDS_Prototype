// Patch 001.1 — presence-vs-absence safety rule regression tests.
// No network, no LLM calls, no cost. Run: npx tsx test/patch0011-claimtype.ts
//
// The bug: Run 002's best automated conversion finding —
//   "2 of 5 pages carry at least one conversion route; 10 dead (empty-href)
//    anchor(s); 6 distinct conversion CTA label(s) in use"
// was downgraded to Indeterminate because the word "empty" inside "(empty-href)"
// matched ABSENCE_PATTERN. Contract 4 then barred the item from supporting any
// constraint, so the dead-CTA evidence could not carry a conversion diagnosis.
//
// Ten anchors with href="" are ten anchors with href="". Rendering cannot
// un-observe them.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as cheerio from "cheerio";
import {
  applyZeroAbsentSafetyRule,
  checkContactForm,
  checkConversionDestinations,
  checkPrimaryCta,
  checkResponsePromise,
  claimsAbsenceOrZero,
} from "../src/evidence/checks.js";
import { collectForms, collectPageLinks, detectEmbedSignals } from "../src/fetcher.js";
import type { SiteCorpus } from "../src/site.js";
import {
  EMPTY_DYNAMIC_SIGNALS,
  EMPTY_EMBED_SIGNALS,
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

function page(file: string, finalUrl: string) {
  const html = readFileSync(join(FIXTURES, file), "utf8");
  const $ = cheerio.load(html);
  return {
    url: finalUrl, finalUrl, status: 200, html,
    text: $("body").text().replace(/\s+/g, " ").trim(),
    title: $("title").first().text().trim(), metaDescription: "",
    h1s: $("h1").map((_, el) => $(el).text().trim()).get(),
    links: [], canonical: "",
    dynamicSignals: { ...EMPTY_DYNAMIC_SIGNALS },
    images: [],
    pageLinks: collectPageLinks($, finalUrl),
    embedSignals: detectEmbedSignals($, html),
    forms: collectForms($, finalUrl),
    fetchedAt: new Date().toISOString(),
  };
}
function corpusOf(homepage: ReturnType<typeof page>, internalPages: ReturnType<typeof page>[] = []): SiteCorpus {
  return { homepage, internalPages, robotsDisallows: [], robotsBlockedUrls: [], unfetchedCandidates: [] };
}
function ev(id: string, value: string, status: ResultStatus, claimType?: EvidenceEntry["claimType"]): EvidenceEntry {
  return {
    evidenceId: id, growthFunction: "Capture", evidenceType: "Observation", evidenceValue: value,
    resultStatus: status, source: "fixture", evidenceAccessibility: "Publicly Observable",
    observation: "fixture.", ...(claimType ? { claimType } : {}),
  };
}

// The Run 002 conditions: embeds present, which is what triggered the downgrade.
const RUN002_SIGNALS: DynamicSignals = { ...EMPTY_DYNAMIC_SIGNALS, embeds: 12 };
const RUN002_EMBEDS: EmbedSignals = { ...EMPTY_EMBED_SIGNALS, reviewWidgets: 2, mapEmbeds: 2, iframes: 1, markers: ["elfsight"] };
const RUN002_VALUE =
  "2 of 5 pages carry at least one conversion route; 10 dead (empty-href) anchor(s); 6 distinct conversion CTA label(s) in use";

console.log("=== 0. Root cause is reproduced, and remains reproducible ===");
check("the wording heuristic still reads the Run 002 value as an absence claim", claimsAbsenceOrZero(RUN002_VALUE));
check("'empty' is the trigger word", claimsAbsenceOrZero("10 dead (empty-href) anchor(s)"));
check("without it the same sentence reads as presence", !claimsAbsenceOrZero("10 dead anchor(s) found"));

console.log("\n=== 1. Presence-based E-CON-101 is no longer downgraded ===");
const before = applyZeroAbsentSafetyRule(ev("E-CON-101", RUN002_VALUE, "Partial"), RUN002_SIGNALS, RUN002_EMBEDS);
check("without claimType the old bug still reproduces", before.resultStatus === "Indeterminate", before.resultStatus);
const after = applyZeroAbsentSafetyRule(ev("E-CON-101", RUN002_VALUE, "Partial", "presence"), RUN002_SIGNALS, RUN002_EMBEDS);
check("declared presence keeps its Partial", after.resultStatus === "Partial", after.resultStatus);
check("value left untouched", after.evidenceValue === RUN002_VALUE);
check("no downgrade note appended", !/Downgraded from/.test(after.observation));
const failCase = applyZeroAbsentSafetyRule(ev("E-CON-101", RUN002_VALUE, "Fail", "presence"), RUN002_SIGNALS, RUN002_EMBEDS);
check("a presence-based Fail also survives", failCase.resultStatus === "Fail", failCase.resultStatus);

console.log("\n=== 2. Presence survives every signal type, not just embeds ===");
for (const sig of ["lazyImages", "galleries", "carousels", "tabs", "accordions", "counters", "embeds"] as const) {
  const r = applyZeroAbsentSafetyRule(
    ev("E-CON-101", RUN002_VALUE, "Partial", "presence"),
    { ...EMPTY_DYNAMIC_SIGNALS, [sig]: 40 },
    RUN002_EMBEDS
  );
  check(`presence survives ${sig}`, r.resultStatus === "Partial", r.resultStatus);
}

console.log("\n=== 3. True absence claims are still protected ===");
const noRoutes = applyZeroAbsentSafetyRule(
  ev("E-CON-101", "0 of 5 pages carry at least one conversion route; 0 dead anchors", "Fail", "absence"),
  RUN002_SIGNALS,
  RUN002_EMBEDS
);
check("no-route absence still downgraded", noRoutes.resultStatus === "Indeterminate", noRoutes.resultStatus);
check("downgrade explains itself", /Absence in static markup is not evidence of absence/.test(noRoutes.observation));
const absenceOddWording = applyZeroAbsentSafetyRule(
  // Declared absence with wording the heuristic would NOT have caught.
  ev("E-CON-101", "Conversion routes total zero across the corpus", "Fail", "absence"),
  RUN002_SIGNALS,
  RUN002_EMBEDS
);
check("declared absence is protected even when wording is unusual", absenceOddWording.resultStatus === "Indeterminate", absenceOddWording.resultStatus);

console.log("\n=== 4. Area D embed safety is unchanged ===");
for (const id of ["E-CON-018", "E-VIS-027"]) {
  const r = applyZeroAbsentSafetyRule(ev(id, "No case studies or badges visible in the supplied content.", "Fail"), EMPTY_DYNAMIC_SIGNALS, RUN002_EMBEDS);
  check(`${id} still becomes Requires Browser Confirmation`, r.resultStatus === "Requires Browser Confirmation", r.resultStatus);
}
check(
  "E-CON-017 embed path intact",
  applyZeroAbsentSafetyRule(ev("E-CON-017", "No testimonials visible.", "Fail"), EMPTY_DYNAMIC_SIGNALS, RUN002_EMBEDS).resultStatus ===
    "Requires Browser Confirmation"
);

console.log("\n=== 5. Existing lazy-image Indeterminate behaviour is unchanged ===");
const lazy = applyZeroAbsentSafetyRule(
  ev("E-CON-018", "No before/after photos visible in the supplied content.", "Fail"),
  { ...EMPTY_DYNAMIC_SIGNALS, lazyImages: 38 },
  EMPTY_EMBED_SIGNALS
);
check("still Indeterminate on lazy images alone", lazy.resultStatus === "Indeterminate", lazy.resultStatus);
check("Pass entries still untouched", applyZeroAbsentSafetyRule(ev("E-CON-017", "Two testimonials present.", "Pass"), RUN002_SIGNALS, RUN002_EMBEDS).resultStatus === "Pass");
check(
  "entries with no absence wording and no claimType still untouched",
  applyZeroAbsentSafetyRule(ev("E-VIS-001", "5 pages checked, titles duplicated", "Partial"), RUN002_SIGNALS, RUN002_EMBEDS).resultStatus === "Partial"
);

console.log("\n=== 6. Real checks declare the right polarity ===");
const home = page("capture-home.html", "https://example.co.za/");
const contact = page("capture-contact.html", "https://example.co.za/contact");
const rich = corpusOf(home, [contact]);
const bare = corpusOf(page("canonical-a.html", "https://example.co.za/plain"));

const cta = checkPrimaryCta(rich);
check("E-CON-101 with dead anchors declares presence", cta.claimType === "presence", String(cta.claimType));
check("E-CON-101 keeps Partial through the real rule", applyZeroAbsentSafetyRule(cta, RUN002_SIGNALS, RUN002_EMBEDS).resultStatus === "Partial");
const ctaBare = checkPrimaryCta(bare);
check("E-CON-101 with no routes declares absence", ctaBare.claimType === "absence", String(ctaBare.claimType));
check("...and is still downgraded when signals warrant", applyZeroAbsentSafetyRule(ctaBare, RUN002_SIGNALS, RUN002_EMBEDS).resultStatus === "Indeterminate");

check("E-CON-102 with destinations declares presence", checkConversionDestinations(rich).claimType === "presence");
check("E-CON-102 with none declares absence", checkConversionDestinations(bare).claimType === "absence");
check("E-CON-103 with forms declares presence", checkContactForm(rich).claimType === "presence");
check("E-CON-103 with none declares absence", checkContactForm(bare).claimType === "absence");
check("E-RES-101 with a promise declares presence", checkResponsePromise(rich).claimType === "presence");
check("E-RES-101 without one declares absence", checkResponsePromise(corpusOf(home)).claimType === "absence");

console.log("\n=== 7. Contract 4 support safety ===");
// Mirrors isReportSafeSupport in contract4-reasoning.ts.
const UNSAFE = new Set(["Indeterminate", "Requires Browser Confirmation"]);
const isReportSafeSupport = (e: EvidenceEntry): boolean =>
  e.resultStatus !== "Not Assessed" && e.resultStatus !== "Not Applicable" && !UNSAFE.has(e.resultStatus);
check("presence-based E-CON-101 may now support a constraint", isReportSafeSupport(applyZeroAbsentSafetyRule(cta, RUN002_SIGNALS, RUN002_EMBEDS)));
check("the pre-fix version could not", !isReportSafeSupport(before));
check("Indeterminate still rejected", !isReportSafeSupport(ev("X", "v", "Indeterminate")));
check("Requires Browser Confirmation still rejected", !isReportSafeSupport(ev("X", "v", "Requires Browser Confirmation")));
check("Not Assessed still rejected", !isReportSafeSupport(ev("X", "v", "Not Assessed")));
check("Pass and Fail still accepted", isReportSafeSupport(ev("X", "v", "Pass")) && isReportSafeSupport(ev("X", "v", "Fail")));

console.log("\n=== 8. The rule is not weakened globally ===");
const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../src/evidence/checks.ts"), "utf8");
check("exemption requires an explicit presence declaration", /entry\.claimType === "presence"/.test(src));
check("heuristic still runs for undeclared entries", /entry\.claimType !== "absence" && !claimsAbsenceOrZero/.test(src));
check("ABSENCE_PATTERN untouched", /const ABSENCE_PATTERN =/.test(src));
check("no LLM-authored id declares presence", !/TEXTUAL_IDS[\s\S]{0,400}claimType: "presence"/.test(src));

console.log(`\n${failed === 0 ? "ALL PASSED" : `${failed} CHECK(S) FAILED`}`);
process.exit(failed === 0 ? 0 : 1);
