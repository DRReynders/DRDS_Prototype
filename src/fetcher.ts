// Real HTTP fetching — the only evidence-gathering method available in this
// prototype (no search API). Every page used by any stage passes through here.

import * as cheerio from "cheerio";
import {
  EMPTY_DYNAMIC_SIGNALS,
  EMPTY_EMBED_SIGNALS,
  type DynamicSignals,
  type EmbedSignals,
  type FetchedPage,
  type LinkType,
  type PageForm,
  type PageFormField,
  type PageImage,
  type PageLink,
} from "./types.js";

const USER_AGENT =
  "DRDS-GrowthSnapshot/0.1 (+https://drdigitalsystems.co.za; automated business growth diagnostic)";
const FETCH_TIMEOUT_MS = 20_000;
const MAX_TEXT_CHARS = 20_000;
const MAX_IMAGE_INVENTORY = 40; // bounded — the run log stays inspectable by hand
const MAX_LINK_INVENTORY = 200; // bounded — nav duplication alone can run to dozens
const MAX_LINK_TEXT_CHARS = 120;
const MAX_FORM_INVENTORY = 12;
const MAX_FORM_FIELDS = 30;

// Phase 1 (P1-a): count markers indicating content this fetch cannot see.
// Runs BEFORE <script> is stripped, so script-based markers (jQuery.numerator)
// are still visible. Counting only — no interpretation happens here.
// Phase 1 (P1-a) + Area D: count markers indicating content this fetch cannot
// see. Runs BEFORE <script> is stripped — essential for both the counter markers
// and the embed ones, since a page builder often ships the whole widget as
// escaped markup inside a script/JSON payload rather than as live DOM.
function detectDynamicSignals($: cheerio.CheerioAPI, embeds: EmbedSignals): DynamicSignals {
  const scriptText = $("script").text();
  const counterEls = $("[data-to-value], .elementor-counter-number, .elementor-counter, [data-counter]").length;
  const numeratorRefs = /jquery\.numerator|\.numerator\s*\(|data-to-value/i.test(scriptText) ? 1 : 0;
  return {
    counters: counterEls + (counterEls === 0 ? numeratorRefs : 0),
    lazyImages: $('img[loading="lazy"], img[data-src], img[data-lazy-src], img[srcset], [data-bg]').length,
    galleries: $(
      '.gallery, .elementor-image-gallery, .elementor-gallery, [data-elementor-lightbox], [data-fancybox], .lightbox, .swiper-slide, [class*="lightbox"]'
    ).length,
    tabs: $('.elementor-tabs, [role="tablist"], .tabs, [data-tab]').length,
    accordions: $(".elementor-accordion, .elementor-toggle, details, .accordion").length,
    carousels: $('.swiper, .elementor-swiper, .slick-slider, .carousel, [data-slider]').length,
    embeds: embeds.iframes + embeds.reviewWidgets + embeds.mapEmbeds + embeds.scriptEmbeds,
  };
}

// Area D: third-party embed families whose content is rendered by another origin.
// The iSmile widget shipped as escaped HTML inside the Zyro grid payload — the
// live DOM held only an empty zero-height container — so the raw markup is
// searched as text, not just queried as DOM.
const REVIEW_WIDGET_MARKERS = [
  "elfsight",
  "static.elfsight.com",
  "trustindex",
  "embedsocial",
  "featurable",
  "reviewsonmywebsite",
  "sociablekit",
  "google reviews",
  "google-reviews",
];
const MAP_EMBED_MARKERS = ["maps.google.com", "google.com/maps/embed", "maps.googleapis.com", "google.com/maps"];
const WIDGET_SCRIPT_HOSTS =
  /<script[^>]+src=["'][^"']*(elfsight|trustindex|embedsocial|featurable|reviewsonmywebsite|sociablekit|widget)[^"']*["']/gi;
const MAX_EMBED_MARKERS = 12;

export function detectEmbedSignals($: cheerio.CheerioAPI, html: string): EmbedSignals {
  const hay = html.toLowerCase();
  const markers: string[] = [];
  const note = (m: string): void => {
    if (markers.length < MAX_EMBED_MARKERS && !markers.includes(m)) markers.push(m);
  };

  const iframes = $("iframe").length;
  if (iframes > 0) note("iframe");

  let reviewWidgets = 0;
  for (const m of REVIEW_WIDGET_MARKERS) {
    if (hay.includes(m)) {
      reviewWidgets++;
      note(m);
    }
  }

  let mapEmbeds = 0;
  for (const m of MAP_EMBED_MARKERS) {
    if (hay.includes(m)) {
      mapEmbeds++;
      note(m);
    }
  }

  const scriptEmbeds = (html.match(WIDGET_SCRIPT_HOSTS) ?? []).length;

  return { iframes, reviewWidgets, mapEmbeds, scriptEmbeds, markers };
}

function collectImages($: cheerio.CheerioAPI, base: string): PageImage[] {
  const out: PageImage[] = [];
  $("img").each((_, el) => {
    if (out.length >= MAX_IMAGE_INVENTORY) return;
    const $el = $(el);
    const raw = $el.attr("src") || $el.attr("data-src") || $el.attr("data-lazy-src") || "";
    let src = raw;
    try {
      if (raw) src = new URL(raw, base).href;
    } catch {
      /* unparsable src — keep the raw value */
    }
    out.push({
      src,
      alt: ($el.attr("alt") ?? "").replace(/\s+/g, " ").trim(),
      lazy: $el.attr("loading") === "lazy" || Boolean($el.attr("data-src") || $el.attr("data-lazy-src")),
    });
  });
  return out;
}

// --- Area B: platform-neutral link / CTA extraction ---

// Destination hosts, matched on the registrable-ish suffix so subdomains count.
const WHATSAPP_HOSTS = /(^|\.)(wa\.me|whatsapp\.com)$/i;
const SOCIAL_HOSTS =
  /(^|\.)(facebook\.com|fb\.com|instagram\.com|twitter\.com|x\.com|linkedin\.com|tiktok\.com|youtube\.com|youtu\.be|pinterest\.com|threads\.net)$/i;
// Third-party scheduling/booking systems seen in SA service businesses, plus the
// common self-hosted paths. Deliberately a short honest list, not a taxonomy.
const BOOKING_HOSTS =
  /(^|\.)(mygc\.co\.za|recomed\.co\.za|calendly\.com|cal\.com|acuityscheduling\.com|squareup\.com|setmore\.com|simplybook\.(me|it)|fresha\.com|booksy\.com|youcanbook\.me|timify\.com|appointedd\.com|doctolib\.[a-z.]+|zocdoc\.com)$/i;
const BOOKING_PATH = /\b(book|booking|bookings|appointment|appointments|schedule|scheduling|reserve|timeslot)\b/i;

// Classification is destination-first: a "Book Now" button that opens WhatsApp is
// a WhatsApp link, because that is where the visitor actually lands. Booking is
// checked before internal/external so a self-hosted /book-online page is still
// recognised as a conversion destination.
export function classifyLink(rawHref: string, resolved: string, pageHost: string): { linkType: LinkType; external: boolean } {
  const href = rawHref.trim();
  if (!href) return { linkType: "empty", external: false };
  if (href.startsWith("#")) return { linkType: "anchor", external: false };

  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(href)?.[1]?.toLowerCase();
  if (scheme === "tel") return { linkType: "tel", external: false };
  if (scheme === "mailto") return { linkType: "mailto", external: false };

  let host = "";
  let pathAndQuery = href;
  try {
    const u = new URL(resolved || href);
    host = u.hostname.replace(/^www\./i, "").toLowerCase();
    pathAndQuery = `${u.pathname}${u.search}`;
  } catch {
    /* unresolvable — fall through with host "" and the raw href as the path */
  }
  const external = host !== "" && host !== pageHost;

  if (WHATSAPP_HOSTS.test(host)) return { linkType: "whatsapp", external };
  if (BOOKING_HOSTS.test(host) || BOOKING_PATH.test(pathAndQuery)) return { linkType: "booking", external };
  if (SOCIAL_HOSTS.test(host)) return { linkType: "social", external };
  return { linkType: external ? "external" : "internal", external };
}

// Exported so tests exercise the real extractor against fixtures rather than a
// hand-kept mirror of it (the mirror in phase1-safety.ts is a known drift risk).
export function collectPageLinks($: cheerio.CheerioAPI, base: string): PageLink[] {
  let pageHost = "";
  try {
    pageHost = new URL(base).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    /* unparsable base — every link then reads as external, which is honest */
  }

  const out: PageLink[] = [];
  $("a[href]").each((_, el) => {
    if (out.length >= MAX_LINK_INVENTORY) return;
    const $el = $(el);
    const href = $el.attr("href") ?? ""; // "" is the finding, not a reason to skip

    let resolved = "";
    try {
      if (href.trim()) resolved = new URL(href, base).href;
    } catch {
      /* unparsable href — resolved stays "", raw href is still recorded */
    }

    // Icon-only CTAs (social buttons, WhatsApp glyphs) carry no text node, so
    // fall back through the attributes that name them for a screen reader.
    const text = (
      $el.text() ||
      $el.attr("aria-label") ||
      $el.attr("title") ||
      $el.find("img[alt]").first().attr("alt") ||
      ""
    )
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_LINK_TEXT_CHARS);

    const { linkType, external } = classifyLink(href, resolved, pageHost);

    out.push({
      text,
      href,
      resolved,
      linkType,
      external,
      pageUrl: base,
      inNav: $el.closest('nav, header, [role="navigation"]').length > 0,
    });
  });
  return out;
}

// Area A1: bounded form inventory. Markup only — presence and fields. Nothing
// here is submitted, and nothing is inferred about delivery or validation.
export function collectForms($: cheerio.CheerioAPI, base: string): PageForm[] {
  const out: PageForm[] = [];
  $("form").each((_, el) => {
    if (out.length >= MAX_FORM_INVENTORY) return;
    const $f = $(el);
    const fields: PageFormField[] = [];
    $f.find("input, textarea, select").each((__, i) => {
      if (fields.length >= MAX_FORM_FIELDS) return;
      const $i = $(i);
      const tag = (i as { tagName?: string }).tagName?.toLowerCase() ?? "";
      const type = ($i.attr("type") || (tag === "input" ? "text" : tag)).toLowerCase();
      if (type === "hidden") return; // not a visible field the visitor fills in
      fields.push({
        type,
        name: ($i.attr("name") ?? "").slice(0, 60),
        placeholder: ($i.attr("placeholder") ?? "").replace(/\s+/g, " ").trim().slice(0, 80),
        required: $i.attr("required") !== undefined,
      });
    });
    out.push({
      action: ($f.attr("action") ?? "").slice(0, 300),
      method: ($f.attr("method") ?? "get").toLowerCase(),
      fields,
      pageUrl: base,
    });
  });
  return out;
}

// Same visible label pointing at two different places — the iSmile case, where
// "Book Now" reached a different WhatsApp number than the booking CTA elsewhere.
// Pure and exported for Area A to consume; nothing calls it in this slice.
export function findRepeatedLabelConflicts(links: PageLink[]): { text: string; hrefs: string[] }[] {
  const byLabel = new Map<string, Set<string>>();
  for (const l of links) {
    const key = l.text.trim().toLowerCase();
    if (!key) continue;
    const dest = l.resolved || l.href;
    if (!byLabel.has(key)) byLabel.set(key, new Set());
    byLabel.get(key)!.add(dest);
  }
  return [...byLabel.entries()]
    .filter(([, dests]) => dests.size > 1)
    .map(([text, dests]) => ({ text, hrefs: [...dests] }));
}

// SSRF guard: this server fetches URLs submitted by strangers, so it must
// refuse anything that could reach internal/private infrastructure.
export function isForbiddenTarget(url: URL): string | null {
  if (url.protocol !== "http:" && url.protocol !== "https:") return "Only http/https URLs are supported.";
  if (url.port && url.port !== "80" && url.port !== "443") return "Non-standard ports are not supported.";
  const host = url.hostname.toLowerCase();
  const isPrivate =
    host === "localhost" ||
    host.endsWith(".local") ||
    host === "0.0.0.0" ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^169\.254\./.test(host) ||
    host === "::1" ||
    host.startsWith("fd") ||
    host.startsWith("fe80") ||
    host.startsWith("[");
  if (isPrivate) return "Private or local network addresses cannot be analysed.";
  return null;
}

export async function fetchPage(url: string): Promise<FetchedPage> {
  try {
    const forbidden = isForbiddenTarget(new URL(url));
    if (forbidden) {
      return {
        url, finalUrl: url, status: 0, html: "", text: "", title: "",
        metaDescription: "", h1s: [], links: [], canonical: "",
        dynamicSignals: { ...EMPTY_DYNAMIC_SIGNALS }, images: [], pageLinks: [],
        embedSignals: { ...EMPTY_EMBED_SIGNALS, markers: [] }, forms: [],
        fetchedAt: new Date().toISOString(),
        error: forbidden,
      };
    }
  } catch {
    /* unparsable URL falls through to the fetch error path below */
  }
  return fetchPageUnchecked(url);
}

async function fetchPageUnchecked(url: string): Promise<FetchedPage> {
  const fetchedAt = new Date().toISOString();
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,*/*" },
    });
    const html = await res.text();
    const $ = cheerio.load(html);

    // Detected before scripts are stripped — some markers live in <script>.
    const embedSignals = detectEmbedSignals($, html);
    const dynamicSignals = detectDynamicSignals($, embedSignals);
    const images = collectImages($, res.url);
    const canonicalRaw = $('link[rel="canonical"]').attr("href")?.trim() ?? "";
    let canonical = "";
    try {
      if (canonicalRaw) canonical = new URL(canonicalRaw, res.url).href;
    } catch {
      /* unparsable canonical — treated as absent */
    }

    $("script, style, noscript").remove();

    // Crawl input — unchanged. Deduplicated absolute URLs only, and it still
    // skips empty hrefs on purpose: an href="" is not a page to fetch.
    const links: string[] = [];
    $("a[href]").each((_, el) => {
      const href = $(el).attr("href");
      if (!href) return;
      try {
        links.push(new URL(href, res.url).href);
      } catch {
        /* unparsable href — skip */
      }
    });

    // Area B — conversion inventory, parallel to `links` and never a substitute.
    // This one keeps the empty hrefs the crawl list correctly discards.
    const pageLinks = collectPageLinks($, res.url);
    const forms = collectForms($, res.url); // Area A1

    const text = $("body").text().replace(/\s+/g, " ").trim().slice(0, MAX_TEXT_CHARS);

    return {
      url,
      finalUrl: res.url,
      status: res.status,
      html,
      text,
      title: $("title").first().text().trim(),
      metaDescription: $('meta[name="description"]').attr("content")?.trim() ?? "",
      h1s: $("h1")
        .map((_, el) => $(el).text().replace(/\s+/g, " ").trim())
        .get(),
      links: [...new Set(links)],
      canonical,
      dynamicSignals,
      images,
      pageLinks,
      embedSignals,
      forms,
      fetchedAt,
    };
  } catch (err) {
    return {
      url,
      finalUrl: url,
      status: 0,
      html: "",
      text: "",
      title: "",
      metaDescription: "",
      h1s: [],
      links: [],
      canonical: "",
      dynamicSignals: { ...EMPTY_DYNAMIC_SIGNALS },
      images: [],
      pageLinks: [],
      embedSignals: { ...EMPTY_EMBED_SIGNALS, markers: [] },
      forms: [],
      fetchedAt,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// robots.txt check — the top-level submitted URL is always fetched (it is the
// literal thing the user asked us to look at); deeper crawling respects robots.
// Minimal parser: only User-agent: * groups, only Disallow lines.
export async function getRobotsDisallows(origin: string): Promise<string[]> {
  try {
    const res = await fetch(`${origin}/robots.txt`, {
      signal: AbortSignal.timeout(10_000),
      headers: { "User-Agent": USER_AGENT },
    });
    if (!res.ok) return [];
    const body = await res.text();
    const disallows: string[] = [];
    let inStarGroup = false;
    for (const raw of body.split(/\r?\n/)) {
      const line = raw.replace(/#.*$/, "").trim();
      if (!line) continue;
      const [key, ...rest] = line.split(":");
      const value = rest.join(":").trim();
      if (key.toLowerCase() === "user-agent") {
        inStarGroup = value === "*";
      } else if (inStarGroup && key.toLowerCase() === "disallow" && value) {
        disallows.push(value);
      }
    }
    return disallows;
  } catch {
    return [];
  }
}

export function isAllowedByRobots(url: string, disallows: string[]): boolean {
  try {
    const path = new URL(url).pathname;
    return !disallows.some((rule) => path.startsWith(rule));
  } catch {
    return false;
  }
}
