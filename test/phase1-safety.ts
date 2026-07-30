// Phase 1 (Rendered Fetcher safety patch) — fixture + replay tests.
// No network, no LLM calls, no cost. Run: npx tsx test/phase1-safety.ts
//
// Each case reproduces a real failure from the two internal rehearsal runs and
// asserts the patched code no longer produces the confident falsehood.

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as cheerio from "cheerio";
import {
  applyZeroAbsentSafetyRule,
  checkCorePageCoverage,
  checkMetaDescriptions,
  checkTitles,
  claimsAbsenceOrZero,
  corpusDynamicSignals,
  distinctByCanonical,
} from "../src/evidence/checks.js";
import { isSiblingTenantUrl } from "../src/site.js";
import type { SiteCorpus } from "../src/site.js";
import { EMPTY_DYNAMIC_SIGNALS, type DynamicSignals, type EvidenceEntry, type FetchedPage } from "../src/types.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

let failed = 0;
function check(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond || !detail ? "" : `  -> ${detail}`}`);
  if (!cond) failed++;
}

// --- Mirror of fetcher.ts extraction, so fixtures can be tested without network ---
// Kept deliberately in step with src/fetcher.ts; if that changes, this must too.
function pageFromFixture(file: string, finalUrl: string): FetchedPage {
  const html = readFileSync(join(FIXTURES, file), "utf8");
  const $ = cheerio.load(html);
  const scriptText = $("script").text();
  const counterEls = $("[data-to-value], .elementor-counter-number, .elementor-counter, [data-counter]").length;
  const numeratorRefs = /jquery\.numerator|\.numerator\s*\(|data-to-value/i.test(scriptText) ? 1 : 0;
  const dynamicSignals: DynamicSignals = {
    counters: counterEls + (counterEls === 0 ? numeratorRefs : 0),
    lazyImages: $('img[loading="lazy"], img[data-src], img[data-lazy-src], img[srcset], [data-bg]').length,
    galleries: $(
      '.gallery, .elementor-image-gallery, .elementor-gallery, [data-elementor-lightbox], [data-fancybox], .lightbox, .swiper-slide, [class*="lightbox"]'
    ).length,
    tabs: $('.elementor-tabs, [role="tablist"], .tabs, [data-tab]').length,
    accordions: $(".elementor-accordion, .elementor-toggle, details, .accordion").length,
    carousels: $('.swiper, .elementor-swiper, .slick-slider, .carousel, [data-slider]').length,
  };
  const canonicalRaw = $('link[rel="canonical"]').attr("href")?.trim() ?? "";
  let canonical = "";
  try {
    if (canonicalRaw) canonical = new URL(canonicalRaw, finalUrl).href;
  } catch {
    /* absent */
  }
  const links: string[] = [];
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    try {
      links.push(new URL(href, finalUrl).href);
    } catch {
      /* skip */
    }
  });
  $("script, style, noscript").remove();
  return {
    url: finalUrl,
    finalUrl,
    status: 200,
    html,
    text: $("body").text().replace(/\s+/g, " ").trim(),
    title: $("title").first().text().trim(),
    metaDescription: $('meta[name="description"]').attr("content")?.trim() ?? "",
    h1s: $("h1").map((_, el) => $(el).text().trim()).get(),
    links: [...new Set(links)],
    canonical,
    dynamicSignals,
    images: [],
    fetchedAt: new Date().toISOString(),
  };
}

function corpusOf(homepage: FetchedPage, internalPages: FetchedPage[] = []): SiteCorpus {
  return { homepage, internalPages, robotsDisallows: [], robotsBlockedUrls: [], unfetchedCandidates: [] };
}

function evidence(id: string, value: string, status: EvidenceEntry["resultStatus"]): EvidenceEntry {
  return {
    evidenceId: id, growthFunction: "x", evidenceType: "Observation", evidenceValue: value,
    resultStatus: status, source: "fixture", evidenceAccessibility: "Publicly Observable", observation: "fixture",
  };
}

console.log("=== Case 1: Elementor counters (Lyle failure) ===");
{
  const page = pageFromFixture("elementor-counter.html", "https://example.com/case-studies/");
  check("counters detected in static HTML", page.dynamicSignals.counters >= 3, `got ${page.dynamicSignals.counters}`);
  check("canonical extracted", page.canonical === "https://example.com/case-studies/", page.canonical);

  const signals = corpusDynamicSignals(corpusOf(page));
  // The literal claim the pipeline made on 2026-07-29.
  const before = evidence(
    "E-CON-018",
    "Case study cards show '0' for every metric (keywords, sign-ups, traffic growth, dollars raised) — no real numbers displayed.",
    "Fail"
  );
  const after = applyZeroAbsentSafetyRule(before, signals);
  check("zero-metric claim downgraded to Indeterminate", after.resultStatus === "Indeterminate", after.resultStatus);
  check("downgrade explains itself", /requires rendered verification/i.test(after.evidenceValue));
  check("original text preserved for the founder", after.evidenceValue.includes("Case study cards show"));
}

console.log("\n=== Case 2: Lazy gallery (Booksy failure) ===");
{
  const page = pageFromFixture("lazy-gallery.html", "https://example.com/profile/");
  check("lazy images detected", page.dynamicSignals.lazyImages >= 3, `got ${page.dynamicSignals.lazyImages}`);
  check("gallery markers detected", page.dynamicSignals.galleries >= 1, `got ${page.dynamicSignals.galleries}`);

  const signals = corpusDynamicSignals(corpusOf(page));
  const before = evidence(
    "E-CON-018",
    "No case studies or before/after visual proof of results are present in the fetched content.",
    "Fail"
  );
  const after = applyZeroAbsentSafetyRule(before, signals);
  check("no-visual-proof claim downgraded", after.resultStatus === "Indeterminate", after.resultStatus);
}

console.log("\n=== Case 3: Canonicalised duplicate (Lyle false defect) ===");
{
  const a = pageFromFixture("canonical-a.html", "https://example.com/services/");
  const b = pageFromFixture("canonical-b.html", "https://example.com/geo-services/");
  const { distinct, collapsed } = distinctByCanonical([a, b]);
  check("two aliases collapse to one page", distinct.length === 1 && collapsed === 1, `distinct=${distinct.length}`);

  const corpus = corpusOf(a, [b]);
  const titles = checkTitles(corpus);
  const metas = checkMetaDescriptions(corpus);
  check("titles NOT reported as duplicated", !/duplicates present/.test(titles.evidenceValue), titles.evidenceValue);
  check("titles status is Pass", titles.resultStatus === "Pass", titles.resultStatus);
  check("meta NOT reported as duplicated", !/duplicates present/.test(metas.evidenceValue), metas.evidenceValue);
  check("canonical collapse disclosed", /canonical/i.test(titles.observation));
}

console.log("\n=== Case 4: Non-standard slugs (Lyle '2 of 5' under-report) ===");
{
  const page = pageFromFixture("nonstandard-slugs.html", "https://example.com/");
  const cov = checkCorePageCoverage(corpusOf(page));
  check("coverage shortfall is Indeterminate, not a confident Fail/Partial", cov.resultStatus === "Indeterminate", cov.resultStatus);
  check("explains that slugs were matched, not rendered nav", /rendered verification/i.test(cov.observation));
}

console.log("\n=== Case 5: Multi-tenant sibling escalation (Booksy failure) ===");
{
  const subject = "https://booksy.com/en-za/32677_van-niekerk-s-barber-shop_barbers_58419_kaapstad";
  const sibling = "https://booksy.com/en-za/43205_duwayne-the-barber_barbers_58419_kaapstad";
  check("sibling business rejected", isSiblingTenantUrl(subject, sibling));
  check("subject's own page accepted", !isSiblingTenantUrl(subject, subject));
  check("platform page accepted", !isSiblingTenantUrl(subject, "https://booksy.com/en-za/p/about"));
  check(
    "normal site unaffected by tenant rule",
    !isSiblingTenantUrl("https://lylevantonder.com/", "https://lylevantonder.com/seo-case-studies/")
  );
}

console.log("\n=== Case 6: Safety rule does not over-fire ===");
{
  // A genuine absence on a page with no dynamic markers must still be a real finding.
  const staticOnly = { ...EMPTY_DYNAMIC_SIGNALS };
  const before = evidence("E-CON-018", "No case studies or before/after proof are present.", "Fail");
  const after = applyZeroAbsentSafetyRule(before, staticOnly);
  check("static page keeps its Fail", after.resultStatus === "Fail", after.resultStatus);

  // A positive finding is never downgraded, dynamic markers or not.
  const positive = evidence("E-CON-017", "Testimonials present from Chris, Evelyn and Niall.", "Pass");
  const stillPass = applyZeroAbsentSafetyRule(positive, { ...EMPTY_DYNAMIC_SIGNALS, carousels: 3 });
  check("positive finding untouched", stillPass.resultStatus === "Pass", stillPass.resultStatus);

  // Irrelevant signals must not trigger a downgrade.
  const irrelevant = applyZeroAbsentSafetyRule(
    evidence("E-SCA-001", "No structured retention process is documented.", "Fail"),
    { ...EMPTY_DYNAMIC_SIGNALS, counters: 5 } // counters are irrelevant to E-SCA-001
  );
  check("irrelevant signal does not downgrade", irrelevant.resultStatus === "Fail", irrelevant.resultStatus);

  check("absence detector works", claimsAbsenceOrZero("No gallery is present"));
  check("zero detector works", claimsAbsenceOrZero("every metric displays 0"));
  check("neutral text not flagged", !claimsAbsenceOrZero("Testimonials from ten named clients are shown"));
}

console.log(`\n${failed === 0 ? "ALL PASSED" : `${failed} CHECK(S) FAILED`}`);
process.exit(failed === 0 ? 0 : 1);
