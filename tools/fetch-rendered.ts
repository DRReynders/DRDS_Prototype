// Phase 2 — Local Rendered Fetch Prototype.
//
// Captures a page the way a visitor sees it, after JavaScript has run: counters
// animated, lazy images loaded, carousels populated. This exists because static
// fetch produced two confident false findings (a photo gallery reported as
// absent; animated counters reported as zeros) that only a rendered view could
// contradict.
//
// LOCAL FOUNDER TOOL ONLY. Not wired into the pipeline, not deployed, not run
// on Railway. No pipeline module is imported and no LLM call is made. It reads
// one URL and writes one JSON file — nothing else.
//
// Usage:
//   npm run fetch:rendered -- <url> [-o out.json] [--screenshot] [--headed]
//
// Portability: no Railway assumption, no env var required, output path is
// caller-supplied. Screenshots are opt-in and never written unless asked for.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { chromium, type Browser, type Page } from "playwright";

// The same honest identifying User-Agent the static fetcher uses. Deliberately
// duplicated from src/fetcher.ts (which keeps it module-private) so this tool
// imports nothing from the pipeline. It is not cosmetic: Playwright's default
// headless UA advertises "HeadlessChrome" and gets throttled — measured against
// lylevantonder.com, the default UA timed out at 25s while this one loaded in
// ~3s. DRDS identifies itself rather than disguising the crawler; that turns
// out to be both the honest option and the fast one.
const USER_AGENT =
  "DRDS-GrowthSnapshot/0.1 (+https://drdigitalsystems.co.za; automated business growth diagnostic)";

const NAV_TIMEOUT_MS = 30_000;
const NETWORK_IDLE_TIMEOUT_MS = 10_000;
const SETTLE_AFTER_SCROLL_MS = 1_500;
const SCROLL_STEP_PX = 600;
const MAX_SCROLL_STEPS = 40;
const MAX_ITEMS = 60; // bound every collection so output stays hand-inspectable

export interface RenderedHeading {
  level: string;
  text: string;
}
export interface RenderedLink {
  text: string;
  href: string;
}
export interface RenderedForm {
  action: string;
  method: string;
  fields: string[];
}
export interface RenderedImage {
  src: string;
  alt: string;
  width: number | null;
  height: number | null;
  lazy: boolean;
}
export interface RenderedCounter {
  rendered: string;
  dataTo: string | null;
  label: string;
}
export interface RenderedWidgets {
  tabs: number;
  accordions: number;
  carousels: number;
  galleries: number;
  counters: number;
  lazyImages: number;
}
export interface RenderedCapture {
  url: string;
  finalUrl: string;
  fetchedAt: string;
  renderMs: number;
  ok: boolean;
  httpStatus: number | null;
  title: string;
  canonical: string;
  metaDescription: string;
  visibleText: string;
  headings: RenderedHeading[];
  navLinks: RenderedLink[];
  ctas: RenderedLink[];
  forms: RenderedForm[];
  images: RenderedImage[];
  counters: RenderedCounter[];
  widgets: RenderedWidgets;
  screenshotPath: string | null;
  warnings: string[];
}

// Everything below runs inside the page. Kept as one function so the whole
// extraction happens against a single settled DOM.
/* eslint-disable */
function extractInPage(maxItems: number) {
  const norm = (s: string | null | undefined) => (s || "").replace(/\s+/g, " ").trim();
  const abs = (h: string | null) => {
    if (!h) return "";
    try {
      return new URL(h, location.href).href;
    } catch {
      return h;
    }
  };
  const take = <T>(arr: T[]) => arr.slice(0, maxItems);

  const headings = take(
    Array.from(document.querySelectorAll("h1, h2, h3"))
      .map((e) => ({ level: e.tagName.toLowerCase(), text: norm((e as HTMLElement).innerText) }))
      .filter((h) => h.text.length > 0)
  );

  // Gather from EVERY nav/header, not just the first: builders like Elementor
  // often emit an empty <header> before the real menu, so querySelector alone
  // silently returns nothing. Falls back to same-origin links in the top of the
  // document when no nav container yields links.
  const navScopes = Array.from(document.querySelectorAll("nav, header, [role='navigation'], .elementor-nav-menu"));
  let navAnchors = navScopes.flatMap((s) => Array.from(s.querySelectorAll("a[href]")));
  if (navAnchors.length === 0) {
    navAnchors = Array.from(document.querySelectorAll("a[href]")).filter((a) => {
      const r = (a as HTMLElement).getBoundingClientRect();
      return r.top >= 0 && r.top < 400;
    });
  }
  const seenNav = new Set<string>();
  const navLinks = take(
    navAnchors
      .map((a) => ({ text: norm((a as HTMLElement).innerText), href: abs(a.getAttribute("href")) }))
      .filter((l) => {
        if (!l.text || !l.href) return false;
        const key = `${l.text}|${l.href}`;
        if (seenNav.has(key)) return false;
        seenNav.add(key);
        return true;
      })
  );

  const ctas = take(
    Array.from(
      document.querySelectorAll("a.elementor-button, .elementor-button-link, button, [role='button'], a.btn, .wp-block-button__link")
    )
      .map((e) => ({ text: norm((e as HTMLElement).innerText), href: abs(e.getAttribute("href")) }))
      .filter((c) => c.text.length > 0)
  );

  const forms = take(
    Array.from(document.querySelectorAll("form")).map((f) => ({
      action: abs(f.getAttribute("action")),
      method: (f.getAttribute("method") || "get").toLowerCase(),
      fields: Array.from(f.querySelectorAll("input, textarea, select"))
        .map((i) => (i as HTMLInputElement).type || i.tagName.toLowerCase())
        .slice(0, 30),
    }))
  );

  const images = take(
    Array.from(document.querySelectorAll("img")).map((i) => {
      const img = i as HTMLImageElement;
      return {
        src: abs(img.currentSrc || img.getAttribute("src") || img.getAttribute("data-src")),
        alt: norm(img.getAttribute("alt")),
        width: img.naturalWidth || null,
        height: img.naturalHeight || null,
        lazy: img.getAttribute("loading") === "lazy" || Boolean(img.getAttribute("data-src")),
      };
    })
  );

  // Counters: read the post-animation text plus the authored target value, so a
  // "0" that never animated is distinguishable from a genuine zero.
  const counterEls = Array.from(document.querySelectorAll(".elementor-counter-number, [data-to-value]"));
  const counters = take(
    counterEls.map((c) => {
      const wrap = c.closest(".elementor-widget-counter") || c.parentElement?.parentElement || c.parentElement;
      return {
        rendered: norm((c as HTMLElement).innerText),
        dataTo: c.getAttribute("data-to-value"),
        label: norm((wrap as HTMLElement | null)?.innerText).slice(0, 80),
      };
    })
  );

  const widgets = {
    tabs: document.querySelectorAll(".elementor-tabs, [role='tablist'], .tabs, [data-tab]").length,
    accordions: document.querySelectorAll(".elementor-accordion, .elementor-toggle, details, .accordion").length,
    carousels: document.querySelectorAll(".swiper, .elementor-swiper, .slick-slider, .carousel, [data-slider]").length,
    galleries: document.querySelectorAll(
      ".gallery, .elementor-image-gallery, .elementor-gallery, [data-elementor-lightbox], [data-fancybox], .lightbox, .swiper-slide"
    ).length,
    counters: counterEls.length,
    lazyImages: document.querySelectorAll("img[loading='lazy'], img[data-src], img[data-lazy-src]").length,
  };

  const bodyText = norm((document.body as HTMLElement).innerText);

  // Cheap heuristics, recorded as warnings rather than acted upon.
  const lower = bodyText.toLowerCase();
  const cookieBanner = /(accept (all )?cookies|cookie (policy|settings|consent)|we use cookies)/.test(lower);
  const botBlock =
    /(are you a robot|verify you are human|access denied|enable javascript to continue|checking your browser|cloudflare)/.test(
      lower
    ) && bodyText.length < 1200;

  return {
    title: document.title || "",
    canonical: abs(document.querySelector("link[rel='canonical']")?.getAttribute("href") ?? ""),
    metaDescription: norm(document.querySelector("meta[name='description']")?.getAttribute("content") ?? ""),
    visibleText: bodyText.slice(0, 20_000),
    headings,
    navLinks,
    ctas,
    forms,
    images,
    counters,
    widgets,
    cookieBanner,
    botBlock,
  };
}
/* eslint-enable */

async function scrollThrough(page: Page): Promise<void> {
  // Stepwise, not a single jump: on-view animations and lazy loaders fire on
  // intersection, so the viewport has to actually pass over them.
  await page.evaluate(
    async ({ step, maxSteps }) => {
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
      let y = 0;
      for (let i = 0; i < maxSteps; i++) {
        y += step;
        window.scrollTo(0, y);
        await sleep(90);
        if (y >= document.body.scrollHeight) break;
      }
      window.scrollTo(0, 0);
      await sleep(120);
    },
    { step: SCROLL_STEP_PX, maxSteps: MAX_SCROLL_STEPS }
  );
}

export async function captureRendered(
  url: string,
  opts: { screenshot?: boolean; headed?: boolean; screenshotPath?: string } = {}
): Promise<RenderedCapture> {
  const startedAt = Date.now();
  const warnings: string[] = [];
  let browser: Browser | null = null;

  const base: RenderedCapture = {
    url,
    finalUrl: url,
    fetchedAt: new Date().toISOString(),
    renderMs: 0,
    ok: false,
    httpStatus: null,
    title: "",
    canonical: "",
    metaDescription: "",
    visibleText: "",
    headings: [],
    navLinks: [],
    ctas: [],
    forms: [],
    images: [],
    counters: [],
    widgets: { tabs: 0, accordions: 0, carousels: 0, galleries: 0, counters: 0, lazyImages: 0 },
    screenshotPath: null,
    warnings,
  };

  try {
    browser = await chromium.launch({ headless: !opts.headed });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      userAgent: USER_AGENT,
    });
    // tsx/esbuild compiles named functions with a `__name` helper that exists in
    // Node but not in the browser, so any evaluated function referencing it dies
    // with "__name is not defined". Shim it before navigation.
    await context.addInitScript(() => {
      const g = globalThis as unknown as { __name?: (fn: unknown) => unknown };
      if (!g.__name) g.__name = (fn: unknown) => fn;
    });

    const page = await context.newPage();
    page.setDefaultTimeout(NAV_TIMEOUT_MS);

    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
    base.httpStatus = response?.status() ?? null;

    try {
      await page.waitForLoadState("networkidle", { timeout: NETWORK_IDLE_TIMEOUT_MS });
    } catch {
      warnings.push("networkidle-timeout-fallback: proceeded after load without full network idle");
    }

    await scrollThrough(page);
    await page.waitForTimeout(SETTLE_AFTER_SCROLL_MS);

    const data = await page.evaluate(extractInPage, MAX_ITEMS);
    base.finalUrl = page.url();
    Object.assign(base, {
      title: data.title,
      canonical: data.canonical,
      metaDescription: data.metaDescription,
      visibleText: data.visibleText,
      headings: data.headings,
      navLinks: data.navLinks,
      ctas: data.ctas,
      forms: data.forms,
      images: data.images,
      counters: data.counters,
      widgets: data.widgets,
    });

    if (data.cookieBanner) warnings.push("cookie-banner-detected: not dismissed — consent is not ours to give");
    if (data.botBlock) warnings.push("possible-bot-block: page content looks like a challenge or denial page");
    if (base.httpStatus !== null && base.httpStatus >= 400) warnings.push(`http-status-${base.httpStatus}`);
    if (!data.visibleText) warnings.push("no-visible-text-extracted");

    if (opts.screenshot) {
      const p = resolve(opts.screenshotPath ?? "rendered-screenshot.png");
      mkdirSync(dirname(p), { recursive: true });
      await page.screenshot({ path: p, fullPage: true });
      base.screenshotPath = p;
    } else {
      warnings.push("screenshot-skipped: opt-in only (--screenshot)");
    }

    base.ok = true;
    await context.close();
  } catch (err) {
    warnings.push(`render-failed: ${err instanceof Error ? err.message : String(err)}`);
    base.ok = false;
  } finally {
    if (browser) await browser.close().catch(() => undefined);
  }

  base.renderMs = Date.now() - startedAt;
  return base;
}

// ---- CLI ----
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const url = args.find((a) => !a.startsWith("-"));
  if (!url) {
    console.error("Usage: npm run fetch:rendered -- <url> [-o out.json] [--screenshot] [--headed]");
    process.exit(1);
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("not http/https");
  } catch {
    console.error(`Not a usable http(s) URL: ${url}`);
    process.exit(1);
  }

  const oIdx = args.indexOf("-o");
  const host = new URL(url).hostname.replace(/[^a-z0-9.-]/gi, "_");
  const outPath = resolve(oIdx >= 0 && args[oIdx + 1] ? args[oIdx + 1] : `rendered-${host}.json`);
  const wantsShot = args.includes("--screenshot");

  console.error(`Rendering ${url} …`);
  const capture = await captureRendered(url, {
    screenshot: wantsShot,
    headed: args.includes("--headed"),
    screenshotPath: outPath.replace(/\.json$/i, "") + ".png",
  });

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(capture, null, 2), "utf8");

  console.error(
    `${capture.ok ? "Rendered" : "FAILED"} in ${(capture.renderMs / 1000).toFixed(1)}s — ` +
      `${capture.headings.length} headings, ${capture.navLinks.length} nav links, ${capture.images.length} images, ` +
      `${capture.counters.length} counters`
  );
  for (const w of capture.warnings) console.error(`  warning: ${w}`);
  console.error(`Written: ${outPath}`);
  if (!capture.ok) process.exit(2);
}

const invokedDirectly = process.argv[1] && /fetch-rendered\.[cm]?ts$/.test(process.argv[1]);
if (invokedDirectly) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
