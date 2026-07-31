// Phase 2 — rendered fetch prototype tests.
// Self-contained: serves a fixture page from localhost and renders it with the
// real tool. No external network, no LLM calls, no cost.
// Run: npx tsx test/phase2-rendered.ts

import { createServer } from "node:http";
import { captureRendered } from "../tools/fetch-rendered.js";

let failed = 0;
function check(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond || !detail ? "" : `  -> ${detail}`}`);
  if (!cond) failed++;
}

// A page that is deliberately hostile to static fetch: the counter ships "0" and
// only animates on view; the gallery image is lazy; the nav sits in a second
// <header> after an empty one (the Elementor pattern that broke navLinks).
const FIXTURE = `<!doctype html><html><head>
<title>Rendered Fixture</title>
<meta name="description" content="fixture page">
<link rel="canonical" href="http://localhost:PORT/canonical-target/">
</head><body>
<header></header>
<header><nav>
  <a href="/">HOME</a>
  <a href="/deliberately-odd-slug/">ABOUT</a>
</nav></header>
<h1>Fixture Heading</h1>
<h2>Second Heading</h2>
<!-- Taller than the viewport on purpose: scroll-triggered animation only fires
     if the page can actually scroll, which is also true of real sites. -->
<div style="height:2400px">spacer</div>
<div class="elementor-widget-counter">
  <span class="elementor-counter-number" data-from-value="0" data-to-value="51831">0</span>
  <span>Total Raised</span>
</div>
<div class="elementor-image-gallery">
  <img loading="lazy" data-src="/img/work.png" src="data:image/gif;base64,R0lGODlhZABkAIAAAP///wAAACH5BAEAAAAALAAAAABkAGQAAAIhhI+py+0Po5y02ouz3rz7D4biSJbmiabqyrbuC8fyTFcAOw==" alt="work example" width="100" height="100">
</div>
<form action="/send" method="post"><input type="email"><textarea></textarea></form>
<a class="elementor-button" href="/talk/">LET'S TALK</a>
<div class="elementor-accordion">acc</div>
<script>
  window.addEventListener('scroll', function () {
    document.querySelectorAll('.elementor-counter-number').forEach(function (c) {
      c.textContent = c.getAttribute('data-to-value');
    });
  });
</script>
</body></html>`;

const server = createServer((_req, res) => {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(FIXTURE.replace(/PORT/g, String(port)));
});

const port: number = await new Promise((resolve) => {
  server.listen(0, "127.0.0.1", () => resolve((server.address() as { port: number }).port));
});
const url = `http://127.0.0.1:${port}/`;
console.log(`fixture served at ${url}\n`);

const cap = await captureRendered(url);

console.log("=== Capture succeeded and schema is complete ===");
check("ok", cap.ok, cap.warnings.join("; "));
check("httpStatus 200", cap.httpStatus === 200, String(cap.httpStatus));
check("renderMs recorded", typeof cap.renderMs === "number" && cap.renderMs > 0);
check("fetchedAt is ISO", !Number.isNaN(Date.parse(cap.fetchedAt)));
for (const field of [
  "url", "finalUrl", "title", "canonical", "metaDescription", "visibleText",
  "headings", "navLinks", "ctas", "forms", "images", "counters", "widgets", "warnings",
] as const) {
  check(`field present: ${field}`, cap[field] !== undefined);
}
check("JSON-serialisable", (() => { try { JSON.parse(JSON.stringify(cap)); return true; } catch { return false; } })());

console.log("\n=== Rendered values beat static markup ===");
check("counter animated away from 0", cap.counters.some((c) => c.rendered !== "0"), JSON.stringify(cap.counters));
check("counter target captured", cap.counters.some((c) => c.dataTo === "51831"));
check("lazy image detected", cap.widgets.lazyImages >= 1, JSON.stringify(cap.widgets));
check("image inventory non-empty", cap.images.length >= 1);
check("image alt captured", cap.images.some((i) => i.alt === "work example"));

console.log("\n=== Structure extraction ===");
check("title", cap.title === "Rendered Fixture", cap.title);
check("canonical resolved absolute", cap.canonical.includes("/canonical-target/"), cap.canonical);
check("meta description", cap.metaDescription === "fixture page");
check("headings found", cap.headings.length >= 2, String(cap.headings.length));
check("nav links found past the empty <header>", cap.navLinks.length >= 2, JSON.stringify(cap.navLinks));
check("non-standard slug captured", cap.navLinks.some((l) => l.href.includes("deliberately-odd-slug")));
check("CTA captured", cap.ctas.some((c) => c.text === "LET'S TALK"));
check("form captured with fields", cap.forms.length === 1 && cap.forms[0].fields.length >= 2);
check("accordion widget counted", cap.widgets.accordions >= 1);
check("visible text extracted", cap.visibleText.includes("Fixture Heading"));

console.log("\n=== Safety / hygiene ===");
check("screenshot NOT captured by default", cap.screenshotPath === null);
check("screenshot skip is disclosed", cap.warnings.some((w) => w.includes("screenshot-skipped")));

console.log("\n=== Failure handling ===");
const bad = await captureRendered("http://127.0.0.1:1/");
check("unreachable host fails cleanly", bad.ok === false);
check("failure recorded as a warning", bad.warnings.some((w) => w.startsWith("render-failed")));
check("failed capture still schema-valid", typeof bad.renderMs === "number" && Array.isArray(bad.images));

server.close();
console.log(`\n${failed === 0 ? "ALL PASSED" : `${failed} CHECK(S) FAILED`}`);
process.exit(failed === 0 ? 0 : 1);
