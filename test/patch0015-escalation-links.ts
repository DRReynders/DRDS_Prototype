// Patch 001.5 — escalation PageLink inventory tests.
// No network, no LLM calls, no cost. Run: npx tsx test/patch0015-escalation-links.ts
//
// Run 003's escalation asked whether a service page's WhatsApp CTA used a working
// URI and answered: "cannot be verified from text alone without JavaScript
// execution or HTML attribute inspection." It was right, and it should never have
// had to say so — escalation receives page.text, an href is not text, and the
// Area B inventory holding the exact answer was never passed in.
//
// The fix adds no fetch, no crawl, no LLM call and no evidence item. It shows the
// escalation what had already been extracted.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as cheerio from "cheerio";
import { collectPageLinks } from "../src/fetcher.js";
import { renderPageLinkInventory } from "../src/types.js";
import type { PageLink } from "../src/types.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURES = join(ROOT, "test/fixtures");

let failed = 0;
function check(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond || !detail ? "" : `  -> ${detail}`}`);
  if (!cond) failed++;
}

const PAGE = "https://example.co.za/orthodontics";
const html = readFileSync(join(FIXTURES, "capture-home.html"), "utf8");
const links = collectPageLinks(cheerio.load(html), PAGE);
const inventory = renderPageLinkInventory(links);

console.log("=== 1. Anchor text and href reach the escalation context ===");
check("inventory is non-empty", inventory.length > 100, String(inventory.length));
check("header names the source page", inventory.includes(PAGE), inventory.split("\n")[0]);
check("header states these are markup-read anchor targets", /anchor targets read from the markup/.test(inventory));
check("anchor labels present", inventory.includes('"WhatsApp us to book"'));
check("link types are labelled", /\[whatsapp\]/.test(inventory) && /\[booking\]/.test(inventory));
check("destinations present", inventory.includes("api.whatsapp.com/send?phone=27671623964"));

console.log("\n=== 2. Empty-href CTAs are included and marked ===");
check("empty type appears", /\[empty\]/.test(inventory));
check("the dead CTA is named", inventory.includes('"WhatsApp Us"'));
check("explicitly described as leading nowhere", /href="" — leads nowhere/.test(inventory));
check("nav placement shown", /\[empty\] \(nav\)/.test(inventory), inventory.split("\n").find((l) => l.includes("[empty]")) ?? "");
check("empty CTAs rank first", (inventory.split("\n").findIndex((l) => /\[empty\]/.test(l)) < inventory.split("\n").findIndex((l) => /\[internal\]/.test(l))));

console.log("\n=== 3-4. WhatsApp, booking, tel and mailto routes are included ===");
check("whatsapp included", /\[whatsapp\]/.test(inventory));
check("booking included", /\[booking\]/.test(inventory));
check("booking marked external", /\[booking\] \(external\)/.test(inventory));
check("booking destination visible", inventory.includes("mygc.co.za"));
check("tel included", /\[tel\]/.test(inventory));
const contactHtml = readFileSync(join(FIXTURES, "capture-contact.html"), "utf8");
const contactInv = renderPageLinkInventory(collectPageLinks(cheerio.load(contactHtml), "https://example.co.za/contact"));
check("mailto included where present", /\[mailto\]/.test(contactInv), contactInv);
check("mailto destination visible", contactInv.includes("reception@example.co.za"));

console.log("\n=== 5. Repeated labels with different destinations are surfaced ===");
check("conflict block present", /REPEATED LABELS WITH DIFFERENT DESTINATIONS/.test(inventory));
check("the conflicting label is named", /"book now" reaches 2 different destinations/.test(inventory));
check("both destinations shown", inventory.includes("27671623964") && inventory.includes("27738361837"));

console.log("\n=== 6. Bounded for large inventories ===");
const many: PageLink[] = Array.from({ length: 400 }, (_, i) => ({
  text: `Link ${i}`,
  href: `/page-${i}`,
  resolved: `https://example.co.za/page-${i}`,
  linkType: "internal",
  external: false,
  pageUrl: PAGE,
  inNav: false,
}));
const big = renderPageLinkInventory(many);
const bodyLines = big.split("\n").filter((l) => l.startsWith("- ["));
check("line count capped at 40", bodyLines.length === 40, String(bodyLines.length));
check("omission is disclosed, not hidden", /… 360 further link\(s\) omitted/.test(big), big.split("\n").slice(-4).join(" | "));
check("output stays a sane size", big.length < 6000, String(big.length));
const longUrl: PageLink[] = [{
  text: "Long", href: "/x", resolved: `https://example.co.za/${"a".repeat(400)}`,
  linkType: "internal", external: false, pageUrl: PAGE, inNav: false,
}];
check("long URLs are truncated", renderPageLinkInventory(longUrl).includes("…"));
check("conversion links survive a crowded page", /\[whatsapp\]/.test(renderPageLinkInventory([...many, ...links])));

console.log("\n=== 7. Pages without pageLinks behave exactly as before ===");
check("empty inventory renders empty string", renderPageLinkInventory([]) === "");
const c3 = readFileSync(join(ROOT, "src/contracts/contract3-evidence.ts"), "utf8");
check("undefined pageLinks defaults to empty", /renderPageLinkInventory\(page\.pageLinks \?\? \[\]\)/.test(c3));
check("nothing appended when inventory is empty", /linkInventory \? `\\n\\n\$\{linkInventory\}` : ""/.test(c3));
check("original page text context preserved", /BODY TEXT:\\n\$\{page\.text\}/.test(c3));

console.log("\n=== 8. No new call, no new crawl, no new evidence ===");
// contract3-evidence.ts holds exactly one llmJson call site — the escalation
// gather. The fixed-subset textual checks live in evidence/checks.ts.
check("escalation still makes exactly one LLM call", (c3.match(/llmJson</g) ?? []).length === 1, String((c3.match(/llmJson</g) ?? []).length));
check("still a single fetchPage in escalation", (c3.match(/fetchPage\(/g) ?? []).length === 1);
check("evidence id unchanged", /evidenceId: "ESC-001"/.test(c3));
check("no new evidence items registered", (c3.match(/check[A-Z]\w+\(corpus\)/g) ?? []).length === 9, String((c3.match(/check[A-Z]\w+\(corpus\)/g) ?? []).length));
check("renderer does not fetch anything", !/fetch|http:|https:\/\//.test(readFileSync(join(ROOT, "src/types.ts"), "utf8").split("export function renderPageLinkInventory")[1]?.split("// Area A1")[0] ?? ""));

console.log("\n=== 9. Escalation stays internal and honest ===");
check("states hrefs were not followed", /Nothing was opened, called, messaged or submitted/.test(inventory));
check("states hrefs are read from markup", /read from markup, not followed/.test(inventory));
check("no client-facing framing", !/you |your /i.test(inventory));

console.log("\n=== 10. Contract 4 safety behaviour intact ===");
const c4 = readFileSync(join(ROOT, "src/contracts/contract4-reasoning.ts"), "utf8");
check("escalation still hard-capped at one attempt", /HARD-CAPPED AT ONE ATTEMPT/.test(c4));
check("sibling-tenant guard intact", /isSiblingTenantUrl/.test(c4));
check("unsafe-support set intact", /UNSAFE_AS_SUPPORT/.test(c4) && /Requires Browser Confirmation/.test(c4));
check("constraint safety gate intact", /requires-rendered-verification/.test(c4));
check("contract 4 untouched by this patch", !/renderPageLinkInventory/.test(c4));

console.log("\n=== 11. Generic, not iSmile-specific ===");
const typesSrc = readFileSync(join(ROOT, "src/types.ts"), "utf8");
// Scoped to the renderer itself. Elsewhere in types.ts, earlier patches cite the
// iSmile rehearsal as historical context in comments — that is documentation of
// why a rule exists, not client-specific behaviour, and it should stay.
const rendererBlock =
  typesSrc.split("export function renderPageLinkInventory")[1]?.split("// Area A1")[0] ?? "";
check("renderer block located", rendererBlock.length > 500, String(rendererBlock.length));
check("no client name in the renderer", !/ismile/i.test(rendererBlock));
check("no hardcoded phone or domain anywhere in types.ts", !/27671623964|mygc\.co\.za/.test(typesSrc));
check("renderer takes links as input, hardcodes no destinations", /links: PageLink\[\]/.test(rendererBlock));

console.log(`\n${failed === 0 ? "ALL PASSED" : `${failed} CHECK(S) FAILED`}`);
process.exit(failed === 0 ? 0 : 1);
