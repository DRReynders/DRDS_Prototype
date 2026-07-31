// Bounded Patch Area A1 — mechanical Capture / Response evidence tests.
// No network, no LLM calls, no cost. Run: npx tsx test/areaa1-capture.ts
//
// Run 001 named a CONVERSION constraint while the evidence subset contained no
// Capture and no Response item at all. These checks close that hole, and every
// case below is drawn from what the iSmile manual extension found by hand: a
// header CTA with href="", two WhatsApp numbers serving one intent, and an
// online-booking handoff present on exactly one page.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as cheerio from "cheerio";
import {
  checkContactForm,
  checkConversionDestinations,
  checkPrimaryCta,
  checkResponsePromise,
} from "../src/evidence/checks.js";
import { collectForms, collectPageLinks, detectEmbedSignals } from "../src/fetcher.js";
import type { SiteCorpus } from "../src/site.js";
import { EMPTY_DYNAMIC_SIGNALS, type FetchedPage } from "../src/types.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

let failed = 0;
function check(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond || !detail ? "" : `  -> ${detail}`}`);
  if (!cond) failed++;
}

// Builds a page using the REAL extractors, so these tests exercise shipped
// behaviour rather than a mirror of it.
function page(file: string, finalUrl: string): FetchedPage {
  const html = readFileSync(join(FIXTURES, file), "utf8");
  const $ = cheerio.load(html);
  const embedSignals = detectEmbedSignals($, html);
  return {
    url: finalUrl,
    finalUrl,
    status: 200,
    html,
    text: $("body").text().replace(/\s+/g, " ").trim(),
    title: $("title").first().text().trim(),
    metaDescription: "",
    h1s: $("h1").map((_, el) => $(el).text().trim()).get(),
    links: [],
    canonical: "",
    dynamicSignals: { ...EMPTY_DYNAMIC_SIGNALS },
    images: [],
    pageLinks: collectPageLinks($, finalUrl),
    embedSignals,
    forms: collectForms($, finalUrl),
    fetchedAt: new Date().toISOString(),
  };
}

function corpusOf(homepage: FetchedPage, internalPages: FetchedPage[] = []): SiteCorpus {
  return { homepage, internalPages, robotsDisallows: [], robotsBlockedUrls: [], unfetchedCandidates: [] };
}

const home = page("capture-home.html", "https://example.co.za/");
const contact = page("capture-contact.html", "https://example.co.za/contact");
const corpus = corpusOf(home, [contact]);

console.log("=== 1. E-CON-101 detects a dead primary CTA (href=\"\") ===");
const cta = checkPrimaryCta(corpus);
check("dead CTA counted", /2 dead \(empty-href\) anchor\(s\)/.test(cta.evidenceValue), cta.evidenceValue);
check("dead CTA named in the observation", cta.observation.includes("WhatsApp Us"), cta.observation);
check("status is not Pass", cta.resultStatus !== "Pass", cta.resultStatus);
check("status is Partial, not a confident Fail", cta.resultStatus === "Partial", cta.resultStatus);
check("static-layer limit disclosed", /injected by JavaScript/i.test(cta.observation));
check("growth function is Capture", cta.growthFunction === "Capture");

console.log("\n=== 2. E-CON-101 reports coverage across pages ===");
check("route coverage counted per page", /2 of 2 pages carry at least one conversion route/.test(cta.evidenceValue), cta.evidenceValue);
const homeOnly = checkPrimaryCta(corpusOf(home));
check("single-page corpus still assessed", homeOnly.resultStatus !== "Not Assessed", homeOnly.resultStatus);
const noRoutes = page("canonical-a.html", "https://example.co.za/plain");
const bare = checkPrimaryCta(corpusOf(noRoutes));
check("corpus with no conversion route fails honestly", bare.resultStatus === "Fail", bare.resultStatus);
check("no-route case reports zero coverage", /0 of 1 pages/.test(bare.evidenceValue), bare.evidenceValue);

console.log("\n=== 3-4. E-CON-102 detects WhatsApp and booking destinations ===");
const dest = checkConversionDestinations(corpus);
check("WhatsApp destinations counted", /2 WhatsApp/.test(dest.evidenceValue), dest.evidenceValue);
check("booking destinations counted", /1 booking \(1 external\)/.test(dest.evidenceValue), dest.evidenceValue);
check("growth function is Capture", dest.growthFunction === "Capture");
check("no destination was followed", /no destination was opened, called, messaged or followed/i.test(dest.observation));

console.log("\n=== 5. E-CON-102 detects repeated CTA labels with different destinations ===");
check("label conflict detected", /resolve to more than one destination/.test(dest.observation), dest.observation);
check("the conflicting label is named", dest.observation.toLowerCase().includes("book now"), dest.observation);
check("split WhatsApp destinations flagged", /2 distinct WhatsApp destinations/.test(dest.observation), dest.observation);
check("status downgraded to Partial by the split", dest.resultStatus === "Partial", dest.resultStatus);

console.log("\n=== 6. E-CON-102 detects tel and mailto routes ===");
check("phone routes counted", /2 phone/.test(dest.evidenceValue), dest.evidenceValue);
check("email routes counted", /1 email/.test(dest.evidenceValue), dest.evidenceValue);
const noDest = checkConversionDestinations(corpusOf(noRoutes));
check("corpus with no destinations fails honestly", noDest.resultStatus === "Fail", noDest.resultStatus);

console.log("\n=== 7. E-CON-103 detects a contact form and its field inventory ===");
const form = checkContactForm(corpus);
check("both forms found", /2 form\(s\) found/.test(form.evidenceValue), form.evidenceValue);
check("one substantive form identified", /1 with 2 or more visible fields/.test(form.evidenceValue), form.evidenceValue);
check("field placeholders inventoried", form.evidenceValue.includes("Enter your first name"), form.evidenceValue);
check("hidden field excluded", !form.evidenceValue.includes("csrf"), form.evidenceValue);
check("status Pass with a usable form", form.resultStatus === "Pass", form.resultStatus);
check("no submission claimed", /No form was submitted/i.test(form.observation));
check("required attribute reported factually", /required attribute/i.test(form.observation));
const noForm = checkContactForm(corpusOf(noRoutes));
check("corpus with no form fails honestly", noForm.resultStatus === "Fail", noForm.resultStatus);

console.log("\n=== 8. E-RES-101 handles the response promise without overclaiming ===");
const resp = checkResponsePromise(corpus);
check("growth function is Response", resp.growthFunction === "Response");
check("promise detected on the contact page", /Response promise present/.test(resp.evidenceValue), resp.evidenceValue);
// whatsapp, booking, tel, mailto from anchors + the contact form itself.
check("channels counted", /5 response channel\(s\)/.test(resp.evidenceValue), resp.evidenceValue);
check("form counted as a response channel", resp.evidenceValue.includes("form"), resp.evidenceValue);
check("status Pass with promise plus channels", resp.resultStatus === "Pass", resp.resultStatus);
check("nothing was sent", /nothing was sent/i.test(resp.observation));

const noPromise = checkResponsePromise(corpusOf(home));
check("absent promise does not become a Fail", noPromise.resultStatus !== "Fail", noPromise.resultStatus);
check("absent promise is Partial", noPromise.resultStatus === "Partial", noPromise.resultStatus);
check(
  "absence is explicitly not claimed as proof",
  /not evidence that none is shown to a visitor/i.test(noPromise.observation),
  noPromise.observation
);
check("post-submission behaviour disclaimed", /not observable without submitting/i.test(noPromise.observation));

console.log("\n=== 9. Corpus without the Area B inventory is Not Assessed, not Fail ===");
const legacy: FetchedPage = { ...home, pageLinks: undefined, forms: undefined };
check("CTA check honest about missing inventory", checkPrimaryCta(corpusOf(legacy)).resultStatus === "Not Assessed");
check("destination check honest about missing inventory", checkConversionDestinations(corpusOf(legacy)).resultStatus === "Not Assessed");
check("form check honest about missing inventory", checkContactForm(corpusOf(legacy)).resultStatus === "Not Assessed");

console.log("\n=== 9b. New items appear in Contract 3 output (mock provider, no paid calls) ===");
process.env.DRDS_LLM_PROVIDER = "mock";
const { runContract3 } = await import("../src/contracts/contract3-evidence.js");
const pkg = await runContract3(corpus);
const ids = pkg.entries.map((e) => e.evidenceId);
for (const id of ["E-CON-101", "E-CON-102", "E-CON-103", "E-RES-101"]) {
  check(`${id} present in the evidence package`, ids.includes(id), ids.join(", "));
}
check("Capture appears as a growth function", pkg.entries.some((e) => e.growthFunction === "Capture"));
check("Response appears as a growth function", pkg.entries.some((e) => e.growthFunction === "Response"));
check("coverage names Capture", /Capture \d+\/\d+/.test(pkg.evidenceCoverage), pkg.evidenceCoverage);
check("coverage names Response", /Response \d+\/\d+/.test(pkg.evidenceCoverage), pkg.evidenceCoverage);
// Patch 001.2 relabelled the header to "By growth function (usable/attempted — …):",
// so match the stable prefix rather than the exact old string.
check(
  "per-growth-function breakdown present",
  /By growth function[^:]*:/.test(pkg.evidenceCoverage),
  pkg.evidenceCoverage
);
console.log(`  coverage string: ${pkg.evidenceCoverage}`);

console.log("\n=== 10. Determinism and serialisability ===");
check("repeat runs are identical", JSON.stringify(checkPrimaryCta(corpus)) === JSON.stringify(cta));
check(
  "JSON-serialisable",
  (() => { try { JSON.parse(JSON.stringify([cta, dest, form, resp])); return true; } catch { return false; } })()
);
for (const e of [cta, dest, form, resp]) {
  check(`${e.evidenceId} has an id, function and observation`, Boolean(e.evidenceId && e.growthFunction && e.observation));
}

console.log(`\n${failed === 0 ? "ALL PASSED" : `${failed} CHECK(S) FAILED`}`);
process.exit(failed === 0 ? 0 : 1);
