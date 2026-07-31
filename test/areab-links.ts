// Bounded Patch Area B — platform-neutral link / CTA extraction tests.
// No network, no LLM calls, no cost. Run: npx tsx test/areab-links.ts
//
// Every case reproduces something the iSmile rehearsal proved invisible to the
// existing layers: a header CTA with href="", conversion destinations on a
// non-WordPress builder, and one label reaching two different numbers.
//
// These call the real extractor from src/fetcher.ts — deliberately not a mirror
// of it, so the tests cannot silently drift from the shipped behaviour.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as cheerio from "cheerio";
import { classifyLink, collectPageLinks, findRepeatedLabelConflicts } from "../src/fetcher.js";
import type { PageLink } from "../src/types.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const BASE = "https://ismiledentalct.example/services";

let failed = 0;
function check(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond || !detail ? "" : `  -> ${detail}`}`);
  if (!cond) failed++;
}

const html = readFileSync(join(FIXTURES, "zyro-cta-links.html"), "utf8");
const $ = cheerio.load(html);
const links = collectPageLinks($, BASE);

const byText = (t: string): PageLink | undefined =>
  links.find((l) => l.text.toLowerCase() === t.toLowerCase());
const ofType = (t: PageLink["linkType"]): PageLink[] => links.filter((l) => l.linkType === t);

console.log("=== 1. Non-WordPress/Zyro anchors are captured at all ===");
// The fixture contains no .elementor-button / .wp-block-button__link / .btn.
check("fixture really is class-free", $(".elementor-button, .wp-block-button__link, .btn").length === 0);
check("anchors captured anyway", links.length >= 14, `got ${links.length}`);
check("every anchor has a pageUrl", links.every((l) => l.pageUrl === BASE));

console.log("\n=== 2. Empty href CTA is preserved, not dropped ===");
const dead = byText("WhatsApp Us");
check("empty-href CTA present", Boolean(dead), "the iSmile header CTA");
check("raw href preserved as empty string", dead?.href === "");
check("classified as empty", dead?.linkType === "empty", dead?.linkType);
check("resolved left blank", dead?.resolved === "");
check("not marked external", dead?.external === false);
check("recorded as in-nav", dead?.inNav === true);
const whitespaceOnly = byText("Blank-but-whitespace CTA");
check("whitespace-only href also counts as empty", whitespaceOnly?.linkType === "empty", whitespaceOnly?.linkType);

console.log("\n=== 3. WhatsApp links are classified ===");
const waBook = byText("WhatsApp us to book");
check("api.whatsapp.com classified whatsapp", waBook?.linkType === "whatsapp", waBook?.linkType);
check("whatsapp link marked external", waBook?.external === true);
check("wa.me also classified whatsapp", ofType("whatsapp").some((l) => l.resolved.includes("wa.me")));

console.log("\n=== 4. tel links are classified ===");
const tel = byText("Call");
check("tel: classified", tel?.linkType === "tel", tel?.linkType);
check("raw tel href preserved", tel?.href === "tel:+27671623964", tel?.href);
check("tel not treated as external", tel?.external === false);

console.log("\n=== 5. mailto links are classified ===");
const mail = byText("Email");
check("mailto: classified", mail?.linkType === "mailto", mail?.linkType);
check("raw mailto href preserved", mail?.href.startsWith("mailto:") === true);

console.log("\n=== 6. Booking-like links are classified ===");
const mygc = byText("Book online now!");
check("third-party booking host classified booking", mygc?.linkType === "booking", mygc?.linkType);
check("booking handoff marked external", mygc?.external === true);
const selfBooking = byText("Book an appointment");
check("self-hosted /book-appointment classified booking", selfBooking?.linkType === "booking", selfBooking?.linkType);
check("self-hosted booking not marked external", selfBooking?.external === false);

console.log("\n=== 7. Repeated CTA label with different destinations ===");
const conflicts = findRepeatedLabelConflicts(links);
const bookNow = conflicts.find((c) => c.text === "book now");
check("conflict detected", Boolean(bookNow), JSON.stringify(conflicts));
check("both destinations recorded", (bookNow?.hrefs.length ?? 0) === 2, JSON.stringify(bookNow?.hrefs));
check(
  "the two destinations are different numbers",
  Boolean(bookNow?.hrefs.some((h) => h.includes("27671623964")) && bookNow?.hrefs.some((h) => h.includes("27738361837")))
);
check("raw PageLink output preserves both for Area A", links.filter((l) => l.text === "Book Now").length === 2);

console.log("\n=== 8. Remaining classifications and icon-only CTAs ===");
check("internal link classified", byText("Services")?.linkType === "internal");
check("external non-social classified", byText("Partner info")?.linkType === "external");
check("fragment classified as anchor", byText("Skip to content")?.linkType === "anchor");
check("social host classified", ofType("social").length >= 2, JSON.stringify(ofType("social").map((l) => l.resolved)));
check("icon-only CTA names itself from img alt", ofType("social").some((l) => l.text === "Go to Facebook page"));
check("icon-only CTA names itself from aria-label", ofType("social").some((l) => l.text === "Go to Instagram page"));
check("nav vs body distinguished", links.some((l) => l.inNav) && links.some((l) => !l.inNav));

console.log("\n=== 9. Existing links: string[] behaviour is unchanged ===");
// The crawl list is built by the untouched loop in fetcher.ts: skip falsy hrefs,
// resolve, dedupe. Rebuilt here to assert the two structures stay different on
// purpose — pageLinks keeps what the crawl list must discard.
const crawlLinks: string[] = [];
$("a[href]").each((_, el) => {
  const href = $(el).attr("href");
  if (!href) return;
  try {
    crawlLinks.push(new URL(href, BASE).href);
  } catch {
    /* skip */
  }
});
const crawl = [...new Set(crawlLinks)];
check("crawl list excludes empty hrefs", !crawl.some((u) => u === "" || u === BASE + '"'));
check("pageLinks keeps empty hrefs the crawl list drops", ofType("empty").length >= 2, String(ofType("empty").length));
check("pageLinks is a superset in count", links.length > crawl.length, `${links.length} vs ${crawl.length}`);
// Every crawl entry is an absolute URL with a scheme — but not necessarily
// http(s): `new URL("tel:+27…", base)` resolves to itself, so tel:/mailto: have
// always appeared here. Unchanged by this slice, and harmless downstream because
// collectSiteCorpus filters candidates by hostname, which those URLs lack.
check("crawl list still resolves to absolute URLs", crawl.every((u) => /^[a-z][a-z0-9+.-]*:/i.test(u)));
check("crawl list still carries non-http schemes as before", crawl.some((u) => u.startsWith("tel:")));

console.log("\n=== 10. Classifier unit cases and bounds ===");
check("empty href", classifyLink("", "", "example.com").linkType === "empty");
check("whitespace href", classifyLink("   ", "", "example.com").linkType === "empty");
check("wa.me host", classifyLink("https://wa.me/27", "https://wa.me/27", "example.com").linkType === "whatsapp");
check(
  "www stripped before host compare",
  classifyLink("https://www.example.com/x", "https://www.example.com/x", "example.com").external === false
);
check("uppercase scheme still classified", classifyLink("TEL:+27123", "", "example.com").linkType === "tel");
check(
  "booking beats social/external ordering",
  classifyLink("https://calendly.com/x", "https://calendly.com/x", "example.com").linkType === "booking"
);
check("unresolvable href does not throw", classifyLink("::::", "", "example.com").linkType === "internal");
check("text is bounded", links.every((l) => l.text.length <= 120));
check("JSON-serialisable", (() => { try { JSON.parse(JSON.stringify(links)); return true; } catch { return false; } })());

console.log(`\n${failed === 0 ? "ALL PASSED" : `${failed} CHECK(S) FAILED`}`);
process.exit(failed === 0 ? 0 : 1);
