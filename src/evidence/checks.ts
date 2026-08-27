// The fixed evidence subset for the public prototype (MVP Definition §6),
// hardcoded by design. Grounded in what Sprint 1A proved valuable. Selection,
// ranking, or dynamic choice of evidence items is future work — do not add it
// here; a smarter Evidence Engine over the full 119-item library comes later.

import { findRepeatedLabelConflicts } from "../fetcher.js";
import { llmJson, loadPrompt } from "../llm/client.js";
import { allPages, canonicalGroupKey, corpusAsText, type SiteCorpus } from "../site.js";
import {
  EMPTY_EMBED_SIGNALS,
  hasAnyDynamicSignal,
  hasReviewOrMapEmbed,
  type DynamicSignals,
  type EmbedSignals,
  type EvidenceEntry,
  type FetchedPage,
  type PageForm,
  type PageLink,
  type ResultStatus,
} from "../types.js";

// --- Phase 1 (P1-b): canonical-aware page grouping ---

// Collapses fetched pages to one representative per canonical target, so a site
// that correctly canonicalises /services/ -> /seo-services/ is not accused of
// duplicate titles for doing the right thing.
export function distinctByCanonical(pages: FetchedPage[]): { distinct: FetchedPage[]; collapsed: number } {
  const seen = new Map<string, FetchedPage>();
  for (const p of pages) {
    const key = canonicalGroupKey(p);
    if (!seen.has(key)) seen.set(key, p);
  }
  return { distinct: [...seen.values()], collapsed: pages.length - seen.size };
}

// --- Phase 1 (P1-c): zero/absent safety rule ---

// Language indicating the check concluded something is missing, empty, or zero.
const ABSENCE_PATTERN =
  /\b(no|none|not (?:present|found|visible|shown|available)|missing|absent|lacks?|lacking|without|empty|placeholder|zero)\b/i;
const ZERO_VALUE_PATTERN = /(?:^|[^\d.,])0(?:[^\d%]|%|\s|$)|['"]0['"]/;

// Which blind spots could plausibly hide the thing each check looks for.
const RELEVANT_SIGNALS: Record<string, (keyof DynamicSignals)[]> = {
  "E-CON-018": ["counters", "galleries", "lazyImages", "carousels", "embeds"], // proof of results
  "E-CON-017": ["carousels", "tabs", "accordions", "lazyImages", "embeds"], // testimonials
  "E-VIS-027": ["lazyImages", "galleries", "carousels", "embeds"], // badges / recognition
  "E-SCA-001": ["tabs", "accordions"], // process described in collapsed UI
  "E-VIS-004": ["tabs", "accordions", "embeds"], // NAP inside a widget or map embed
  // Area A1. Conversion controls are routinely injected client-side — on iSmile
  // the WhatsApp hrefs were absent from the static HTML entirely and only
  // appeared once JavaScript ran. A static "no WhatsApp route" claim is exactly
  // the false negative this rule exists to stop.
  "E-CON-101": ["embeds", "tabs", "accordions"],
  "E-CON-102": ["embeds", "tabs", "accordions"],
  "E-CON-103": ["embeds", "tabs", "accordions"],
  "E-RES-101": ["embeds", "tabs", "accordions"],
};

export function corpusDynamicSignals(corpus: SiteCorpus): DynamicSignals {
  const total: DynamicSignals = {
    counters: 0, lazyImages: 0, galleries: 0, tabs: 0, accordions: 0, carousels: 0, embeds: 0,
  };
  for (const p of allPages(corpus)) {
    for (const k of Object.keys(total) as (keyof DynamicSignals)[]) total[k] += p.dynamicSignals?.[k] ?? 0;
  }
  return total;
}

// --- Area D: third-party embed / browser confirmation rule ---

// Checks whose subject matter is routinely delivered by a third-party widget:
// reviews, testimonials, ratings, trust badges, proof of results, map/location.
// For these, "absent from the markup we can read" and "absent from the page a
// visitor sees" are different claims, and only a browser can tell them apart.
const EMBED_SENSITIVE_IDS = new Set([
  "E-CON-017", // testimonials / reviews
  "E-CON-018", // case studies / before-after / outcome proof
  "E-VIS-027", // credibility badges / third-party recognition
  "E-VIS-018", // GBP claimed/active
  "E-VIS-037", // GBP verified
  "E-VIS-020", // GBP review volume/recency
]);

export function corpusEmbedSignals(corpus: SiteCorpus): EmbedSignals {
  const total: EmbedSignals = { ...EMPTY_EMBED_SIGNALS, markers: [] };
  for (const p of allPages(corpus)) {
    const e = p.embedSignals;
    if (!e) continue;
    total.iframes += e.iframes;
    total.reviewWidgets += e.reviewWidgets;
    total.mapEmbeds += e.mapEmbeds;
    total.scriptEmbeds += e.scriptEmbeds;
    for (const m of e.markers) if (!total.markers.includes(m)) total.markers.push(m);
  }
  return total;
}

export function claimsAbsenceOrZero(text: string): boolean {
  return ABSENCE_PATTERN.test(text) || ZERO_VALUE_PATTERN.test(text);
}

// The rule: static fetch may report what it saw, but it may not convert silence
// into a confident failure when the markup says the content is rendered later.
//
// Area D adds a second, stronger outcome. Where the missing thing is the kind a
// third-party widget supplies AND embed markers are present, the honest verdict
// is not "we could not verify locally" (Indeterminate) but "only a browser can
// settle this" (Requires Browser Confirmation) — because no amount of local
// rendering will ever resolve content another origin draws. Checked first: it is
// the more specific diagnosis, and it must not be masked by a lazy-image match.
export function applyZeroAbsentSafetyRule(
  entry: EvidenceEntry,
  signals: DynamicSignals,
  embeds: EmbedSignals = EMPTY_EMBED_SIGNALS
): EvidenceEntry {
  if (entry.resultStatus !== "Fail" && entry.resultStatus !== "Partial") return entry;

  // Patch 001.1. A check that directly observed and counted a defect is not
  // making an absence claim, and no amount of rendering can un-observe it. Ten
  // anchors with href="" are ten anchors with href="". Run 002 downgraded exactly
  // that finding because the word "empty" appears in "(empty-href)" — a wording
  // accident, not a judgement about the evidence.
  //
  // Only checks that explicitly declare "presence" are exempt. Everything that
  // leaves claimType undefined — every LLM-authored entry included — still goes
  // through the heuristic unchanged, so the rule is not weakened for anything it
  // was written to protect.
  if (entry.claimType === "presence") return entry;

  // An explicit "absence" declaration is trusted over the wording heuristic in
  // the other direction too: the check said it concluded something is missing, so
  // it is eligible for protection whatever words it happened to use.
  if (entry.claimType !== "absence" && !claimsAbsenceOrZero(entry.evidenceValue)) return entry;

  if (EMBED_SENSITIVE_IDS.has(entry.evidenceId) && hasReviewOrMapEmbed(embeds)) {
    const named = embeds.markers.length ? embeds.markers.join(", ") : "third-party embed container";
    return {
      ...entry,
      resultStatus: "Requires Browser Confirmation",
      evidenceValue: `${entry.evidenceValue} [Not confirmed — this content is supplied by a third-party embed and requires consumer-browser confirmation.]`,
      observation:
        `${entry.observation} Reclassified from ${entry.resultStatus} to Requires Browser Confirmation: the page carries ` +
        `third-party embed markers (${named}) of the kind that deliver reviews, ratings or maps from another origin. ` +
        `No layer in this run executes them, so their content cannot be observed here. This is a limitation of our ` +
        `tooling, NOT a defect of the website: it must not be reported as missing without a consumer-browser check or ` +
        `a screenshot, and a paid report must carry that screenshot where the point is load-bearing.`,
    };
  }

  const relevant = RELEVANT_SIGNALS[entry.evidenceId];
  const triggered = relevant
    ? relevant.filter((k) => signals[k] > 0)
    : hasAnyDynamicSignal(signals)
      ? (Object.keys(signals) as (keyof DynamicSignals)[]).filter((k) => signals[k] > 0)
      : [];
  if (triggered.length === 0) return entry;

  return {
    ...entry,
    resultStatus: "Indeterminate",
    evidenceValue: `${entry.evidenceValue} [Static fetch could not verify this — requires rendered verification.]`,
    observation:
      `${entry.observation} Downgraded from ${entry.resultStatus} to Indeterminate: this run reads static HTML only and ` +
      `executes no JavaScript, and the page carries markers of content rendered after load (${triggered
        .map((k) => `${k}: ${signals[k]}`)
        .join(", ")}). Absence in static markup is not evidence of absence for a real visitor.`,
  };
}

// Static metadata from the Evidence Library V1, for the subset only.
const META: Record<
  string,
  { growthFunction: string; evidenceType: string; question: string }
> = {
  "E-VIS-001": { growthFunction: "Discoverability", evidenceType: "Observation", question: "Unique, descriptive title tags on core pages" },
  "E-VIS-002": { growthFunction: "Discoverability", evidenceType: "Observation", question: "Unique meta descriptions on core pages" },
  "E-VIS-003": { growthFunction: "Discoverability", evidenceType: "Observation", question: "Single clear H1 per page, matching page topic" },
  "E-VIS-016": { growthFunction: "Credibility", evidenceType: "Observation", question: "Valid SSL certificate (HTTPS)" },
  "E-VIS-041": { growthFunction: "Discoverability", evidenceType: "Observation", question: "Comprehensive core page set (services, about, testimonials, blog/resources)" },
  "E-VIS-004": { growthFunction: "Discoverability / Credibility", evidenceType: "Observation", question: "Name, Address, Phone identical everywhere they appear" },
  "E-VIS-027": { growthFunction: "Credibility", evidenceType: "Observation", question: "Credibility badges / third-party recognition visible" },
  "E-CON-017": { growthFunction: "Credibility", evidenceType: "Observation", question: "Customer testimonials on the site itself" },
  "E-CON-018": { growthFunction: "Credibility / Persuasion", evidenceType: "Observation", question: "Case studies or before/after proof of results" },
  "E-VIS-018": { growthFunction: "Discoverability", evidenceType: "Observation", question: "Claimed, active Google Business Profile" },
  "E-VIS-037": { growthFunction: "Discoverability", evidenceType: "Observation", question: "Google Business Profile verified" },
  "E-VIS-020": { growthFunction: "Credibility / Advocacy", evidenceType: "Observation", question: "Healthy volume of recent GBP reviews" },
  "E-SCA-001": { growthFunction: "Retention", evidenceType: "Interview (checked here as public claim only)", question: "Structured client retention process (as publicly claimed)" },
  // Area A1 — Capture / Response. Mechanical, deterministic, no LLM cost.
  "E-CON-101": { growthFunction: "Capture", evidenceType: "Observation", question: "Primary CTA present, working, and consistent across core pages" },
  "E-CON-102": { growthFunction: "Capture", evidenceType: "Observation", question: "Conversion destinations reachable and internally consistent" },
  "E-CON-103": { growthFunction: "Capture", evidenceType: "Observation", question: "Contact form present with a usable field set" },
  "E-RES-101": { growthFunction: "Response", evidenceType: "Observation", question: "Visible response promise and breadth of response channels" },
};

const TEXTUAL_IDS = ["E-VIS-004", "E-VIS-027", "E-CON-017", "E-CON-018", "E-SCA-001"];

// GBP items: no method exists in this run mode (direct fetch only — Google
// surfaces are JS-rendered and unreachable without a search/places API). Always
// honestly Not Assessed, mirroring the 3-for-3 outcome in the paper exercises.
const GBP_IDS = ["E-VIS-018", "E-VIS-037", "E-VIS-020"];

function entry(
  evidenceId: string,
  evidenceValue: string,
  resultStatus: ResultStatus,
  source: string,
  observation: string
): EvidenceEntry {
  const m = META[evidenceId];
  return {
    evidenceId,
    growthFunction: m.growthFunction,
    evidenceType: m.evidenceType,
    evidenceValue,
    resultStatus,
    source,
    evidenceAccessibility: "Publicly Observable",
    observation,
  };
}

// --- Mechanical checks (pure code over fetched pages) ---

export function checkSsl(corpus: SiteCorpus): EvidenceEntry {
  const hp = corpus.homepage;
  const https = hp.finalUrl.startsWith("https://") && !hp.error && hp.status < 400;
  return {
    ...entry(
      "E-VIS-016",
      https
        ? `Site loads successfully over HTTPS (${hp.finalUrl})`
        : `Site did not load cleanly over HTTPS (status ${hp.status}${hp.error ? `, ${hp.error}` : ""})`,
      https ? "Pass" : "Fail",
      "Direct fetch",
      "Node.js rejects invalid/expired certificates by default, so a successful HTTPS fetch implies a valid certificate."
    ),
    facts: { https: https ? 1 : 0 },
  };
}

export function checkTitles(corpus: SiteCorpus): EvidenceEntry {
  const all = allPages(corpus);
  if (!all.length)
    return entry("E-VIS-001", "No pages could be fetched", "Not Assessed", "Direct fetch", "Fetch blocked or failed.");
  // P1-b: compare one page per canonical target — canonicalised aliases are a
  // correct implementation, not a duplicate-content defect.
  const { distinct: pages, collapsed } = distinctByCanonical(all);
  const titles = pages.map((p) => p.title);
  const missing = titles.filter((t) => !t).length;
  const unique = new Set(titles.filter(Boolean)).size;
  const duplicated = unique < titles.filter(Boolean).length;
  const status: ResultStatus = missing === 0 && !duplicated ? "Pass" : missing === titles.length ? "Fail" : "Partial";
  const canonicalNote = collapsed
    ? ` ${collapsed} fetched URL(s) collapsed by rel="canonical" and not counted as duplicates.`
    : "";
  return {
    ...entry(
      "E-VIS-001",
      `${pages.length} pages checked: ${missing} missing titles, ${duplicated ? "duplicates present" : "all unique"}. Examples: ${titles.filter(Boolean).slice(0, 3).join(" | ")}`,
      status,
      pages.map((p) => p.finalUrl).join(", "),
      `Checked across the ${pages.length} distinct fetched core pages only, not the full site.${canonicalNote}`
    ),
    facts: { pages: pages.length, missing, duplicated: duplicated ? 1 : 0 },
  };
}

export function checkMetaDescriptions(corpus: SiteCorpus): EvidenceEntry {
  const all = allPages(corpus);
  if (!all.length)
    return entry("E-VIS-002", "No pages could be fetched", "Not Assessed", "Direct fetch", "Fetch blocked or failed.");
  const { distinct: pages, collapsed } = distinctByCanonical(all); // P1-b
  const descs = pages.map((p) => p.metaDescription);
  const missing = descs.filter((d) => !d).length;
  const unique = new Set(descs.filter(Boolean)).size;
  const duplicated = unique < descs.filter(Boolean).length;
  const status: ResultStatus = missing === 0 && !duplicated ? "Pass" : missing === descs.length ? "Fail" : "Partial";
  const canonicalNote = collapsed
    ? ` ${collapsed} fetched URL(s) collapsed by rel="canonical" and not counted as duplicates.`
    : "";
  return {
    ...entry(
      "E-VIS-002",
      `${pages.length} pages checked: ${missing} missing meta descriptions, ${duplicated ? "duplicates present" : "no duplicates"}.`,
      status,
      pages.map((p) => p.finalUrl).join(", "),
      `Checked across the ${pages.length} distinct fetched core pages only.${canonicalNote}`
    ),
    facts: { pages: pages.length, missing, duplicated: duplicated ? 1 : 0 },
  };
}

export function checkH1s(corpus: SiteCorpus): EvidenceEntry {
  const pages = allPages(corpus);
  if (!pages.length)
    return entry("E-VIS-003", "No pages could be fetched", "Not Assessed", "Direct fetch", "Fetch blocked or failed.");
  const bad = pages.filter((p) => p.h1s.length !== 1);
  const status: ResultStatus = bad.length === 0 ? "Pass" : bad.length === pages.length ? "Fail" : "Partial";
  return {
    ...entry(
      "E-VIS-003",
      `${pages.length} pages checked: ${bad.length} with missing or multiple H1s. Example H1s: ${pages.flatMap((p) => p.h1s).slice(0, 3).join(" | ")}`,
      status,
      pages.map((p) => p.finalUrl).join(", "),
      "Heading structure below H1 not assessed — H1 presence/uniqueness only."
    ),
    facts: { pages: pages.length, bad: bad.length },
  };
}

export function checkCorePageCoverage(corpus: SiteCorpus): EvidenceEntry {
  const discovered = [
    ...allPages(corpus).map((p) => p.finalUrl),
    ...corpus.unfetchedCandidates,
    ...corpus.robotsBlockedUrls,
  ];
  const found: string[] = [];
  const wanted: [string, RegExp][] = [
    ["services", /service|practice|what-we-do|offering/i],
    ["about", /about|team|who-we-are/i],
    ["contact", /contact/i],
    ["testimonials/reviews", /testimonial|review/i],
    ["blog/resources", /blog|news|article|insight|resource/i],
  ];
  for (const [name, pattern] of wanted) {
    if (discovered.some((u) => pattern.test(u))) found.push(name);
  }
  let status: ResultStatus = found.length >= 4 ? "Pass" : found.length >= 2 ? "Partial" : "Fail";

  // P1-c: this check matches URL *strings*, so a site using descriptive slugs
  // (/performance-marketing-specialist/ rather than /about/) reads as missing
  // pages it actually has. If unclassified internal links remain, the shortfall
  // is unproven — say so rather than assert absence.
  // Only where the check is actually ASSERTING a shortfall. A Pass makes no
  // absence claim, so it needs no hedging — downgrading it would be noise.
  let slugNote = "";
  if (status !== "Pass" && found.length < wanted.length) {
    let host = "";
    try {
      host = new URL(corpus.homepage.finalUrl).hostname.replace(/^www\./i, "");
    } catch {
      /* leave host empty — the filter below then matches nothing */
    }
    const unclassified = [...new Set(corpus.homepage.links)].filter((href) => {
      try {
        const u = new URL(href);
        if (u.hostname.replace(/^www\./i, "") !== host) return false;
        if (u.pathname === "/" || u.pathname === "") return false;
        return !wanted.some(([, pattern]) => pattern.test(href));
      } catch {
        return false;
      }
    });
    if (unclassified.length > 0) {
      status = "Indeterminate";
      slugNote =
        ` ${unclassified.length} internal link(s) did not match any expected page-type pattern; this check reads URL slugs, ` +
        `not rendered navigation, so pages using descriptive slugs may exist but be uncounted. Requires rendered verification ` +
        `before any claim that page types are missing.`;
    }
  }

  return {
    ...entry(
      "E-VIS-041",
      `Core page types found via homepage navigation: ${found.join(", ") || "none"} (${found.length} of ${wanted.length} expected types matched by URL pattern)`,
      status,
      corpus.homepage.finalUrl,
      `Assessed from link URLs discovered on the homepage — pages linked only from deeper navigation may be missed.${slugNote}`
    ),
    facts: { found: found.length, wanted: wanted.length },
  };
}

// --- Area A1: mechanical Capture / Response checks ---
//
// Deterministic, no LLM call, built entirely from the Area B PageLink inventory
// and the Area A1 form inventory. They exist because Run 001 named a CONVERSION
// constraint while the evidence subset contained no Capture or Response item at
// all — the constraint won a race it ran alone.
//
// Every value below is phrased as what was FOUND, not what is missing, so that a
// static-layer blind spot degrades into a smaller positive claim rather than a
// confident false absence. Where a genuine absence has to be stated, the entry
// goes through applyZeroAbsentSafetyRule like every other absence claim.

const CONVERSION_TYPES: PageLink["linkType"][] = ["whatsapp", "booking", "tel", "mailto"];

function allPageLinks(corpus: SiteCorpus): PageLink[] {
  return allPages(corpus).flatMap((p) => p.pageLinks ?? []);
}

function allForms(corpus: SiteCorpus): PageForm[] {
  return allPages(corpus).flatMap((p) => p.forms ?? []);
}

// True when no page carried a link inventory at all — i.e. the corpus predates
// Area B. Distinguishes "checked and found nothing" from "never looked".
function noLinkInventory(corpus: SiteCorpus): boolean {
  return allPages(corpus).every((p) => p.pageLinks === undefined);
}

function label(l: PageLink): string {
  return l.text.trim() || "(unlabelled)";
}

export function checkPrimaryCta(corpus: SiteCorpus): EvidenceEntry {
  const pages = allPages(corpus);
  const sources = pages.map((p) => p.finalUrl).join(", ");
  if (!pages.length || noLinkInventory(corpus)) {
    return entry("E-CON-101", "No link inventory available for this corpus", "Not Assessed", sources || "N/A",
      "Pages were fetched without the Area B link inventory, so CTA presence could not be assessed mechanically.");
  }

  const links = allPageLinks(corpus);
  const dead = links.filter((l) => l.linkType === "empty");
  const pagesWithRoute = pages.filter((p) =>
    (p.pageLinks ?? []).some((l) => CONVERSION_TYPES.includes(l.linkType))
  );
  const deadLabels = [...new Set(dead.map(label))].slice(0, 5);

  // Consistency = does a conversion route appear on every fetched page, and do
  // the same CTA labels recur, rather than each page inventing its own?
  const routeLabels = links
    .filter((l) => CONVERSION_TYPES.includes(l.linkType))
    .map((l) => label(l).toLowerCase());
  const distinctRouteLabels = new Set(routeLabels).size;
  const consistent = pagesWithRoute.length === pages.length;

  let status: ResultStatus;
  if (pagesWithRoute.length === 0) status = "Fail";
  else if (dead.length > 0 || !consistent) status = "Partial";
  else status = "Pass";

  const deadNote = dead.length
    ? ` ${dead.length} anchor(s) carry an empty href and lead nowhere: ${deadLabels.join(", ")}.`
    : " No dead (empty-href) anchors found.";
  const coverageNote = ` A conversion route was found on ${pagesWithRoute.length} of ${pages.length} fetched pages.`;

  // Patch 001.1 — claim polarity, decided by what was actually found.
  // No route anywhere is a genuine absence claim, and JavaScript-injected CTAs
  // are exactly how that claim goes wrong, so it keeps its protection. Dead
  // anchors are counted defects sitting in the markup we read: observed, not
  // inferred from silence, and not something a renderer can take back.
  const claimType: EvidenceEntry["claimType"] =
    pagesWithRoute.length === 0 ? "absence" : dead.length > 0 ? "presence" : "mixed";

  return {
    ...entry(
      "E-CON-101",
      `${pagesWithRoute.length} of ${pages.length} pages carry at least one conversion route; ${dead.length} dead (empty-href) anchor(s); ` +
        `${distinctRouteLabels} distinct conversion CTA label(s) in use`,
      status,
      sources,
      `Counted from anchors in the fetched markup.${coverageNote}${deadNote} ` +
        `Static markup only — CTAs injected by JavaScript after load would not appear here, so the ` +
        `route-coverage figure is a floor, not a ceiling. The dead anchors above were directly observed.`
    ),
    claimType,
    facts: {
      pages: pages.length,
      pagesWithRoute: pagesWithRoute.length,
      dead: dead.length,
      distinctRouteLabels,
    },
  };
}

export function checkConversionDestinations(corpus: SiteCorpus): EvidenceEntry {
  const pages = allPages(corpus);
  const sources = pages.map((p) => p.finalUrl).join(", ");
  if (!pages.length || noLinkInventory(corpus)) {
    return entry("E-CON-102", "No link inventory available for this corpus", "Not Assessed", sources || "N/A",
      "Pages were fetched without the Area B link inventory, so conversion destinations could not be assessed mechanically.");
  }

  const links = allPageLinks(corpus);
  const destinationsOf = (t: PageLink["linkType"]): string[] =>
    [...new Set(links.filter((l) => l.linkType === t).map((l) => l.resolved || l.href))];

  const whatsapp = destinationsOf("whatsapp");
  const booking = destinationsOf("booking");
  const tel = destinationsOf("tel");
  const mailto = destinationsOf("mailto");
  const externalBooking = links.filter((l) => l.linkType === "booking" && l.external).length;
  const conflicts = findRepeatedLabelConflicts(links);

  // Split destination = one intent, several endpoints. On iSmile two different
  // WhatsApp numbers served booking intent, and the high-value page used the
  // one the rest of the site did not.
  const splitWhatsapp = whatsapp.length > 1;
  const splitBooking = booking.length > 1;
  const totalRoutes = whatsapp.length + booking.length + tel.length + mailto.length;

  let status: ResultStatus;
  if (totalRoutes === 0) status = "Fail";
  else if (conflicts.length > 0 || splitWhatsapp || splitBooking) status = "Partial";
  else status = "Pass";

  const conflictNote = conflicts.length
    ? ` ${conflicts.length} CTA label(s) resolve to more than one destination: ` +
      conflicts.slice(0, 3).map((c) => `"${c.text}" -> ${c.hrefs.length} destinations`).join("; ") + "."
    : " No CTA label resolves to more than one destination.";
  const splitNote =
    (splitWhatsapp ? ` ${whatsapp.length} distinct WhatsApp destinations are in use.` : "") +
    (splitBooking ? ` ${booking.length} distinct booking destinations are in use.` : "");

  // Patch 001.1: destinations and label conflicts are counted observations. Only
  // "we found no destinations at all" is an absence claim.
  return {
    ...entry(
      "E-CON-102",
      `Conversion destinations found: ${whatsapp.length} WhatsApp, ${booking.length} booking (${externalBooking} external), ` +
        `${tel.length} phone, ${mailto.length} email`,
      status,
      sources,
      `Destinations read from anchor targets in the fetched markup — no destination was opened, called, messaged or ` +
        `followed.${conflictNote}${splitNote} Static markup only; JavaScript-injected destinations would not appear here.`
    ),
    claimType: totalRoutes === 0 ? "absence" : "presence",
    facts: {
      whatsapp: whatsapp.length,
      booking: booking.length,
      tel: tel.length,
      mailto: mailto.length,
      externalBooking,
      conflicts: conflicts.length,
      totalRoutes,
    },
  };
}

export function checkContactForm(corpus: SiteCorpus): EvidenceEntry {
  const pages = allPages(corpus);
  const sources = pages.map((p) => p.finalUrl).join(", ");
  if (!pages.length || pages.every((p) => p.forms === undefined)) {
    return entry("E-CON-103", "No form inventory available for this corpus", "Not Assessed", sources || "N/A",
      "Pages were fetched without the Area A1 form inventory, so contact form presence could not be assessed mechanically.");
  }

  const forms = allForms(corpus);
  const substantive = forms.filter((f) => f.fields.length >= 2);
  const fieldNames = [
    ...new Set(forms.flatMap((f) => f.fields.map((x) => x.placeholder || x.name || x.type))),
  ].slice(0, 12);
  const anyRequired = forms.some((f) => f.fields.some((x) => x.required));

  let status: ResultStatus;
  if (forms.length === 0) status = "Fail";
  else if (substantive.length === 0) status = "Partial";
  else status = "Pass";

  const requiredNote = substantive.length
    ? anyRequired
      ? " At least one field carries the HTML required attribute."
      : " No field carries the HTML required attribute; a builder may still validate in JavaScript, which is not observable here."
    : "";

  // Patch 001.1: a counted inventory of forms is an observation; no forms at all
  // is an absence claim, and forms are commonly injected by page builders.
  return {
    ...entry(
      "E-CON-103",
      forms.length
        ? `${forms.length} form(s) found, ${substantive.length} with 2 or more visible fields. Fields seen: ${fieldNames.join(", ") || "none"}`
        : "No form elements found in the fetched markup",
      status,
      sources,
      `Read from form markup only. No form was submitted and no field was filled, so delivery, validation and ` +
        `post-submission behaviour are all unassessed.${requiredNote}`
    ),
    claimType: forms.length === 0 ? "absence" : "presence",
    facts: { forms: forms.length, substantive: substantive.length, anyRequired: anyRequired ? 1 : 0 },
  };
}

// Wording that constitutes a visible promise about replying. Deliberately narrow
// — a vague "get in touch" is not a response promise.
const RESPONSE_PROMISE = /\b(we(?:'| w)?ll (?:get back|respond|reply|contact you)|response time|respond within|reply within|get back to you within|same[- ]day (?:reply|response)|within \d+\s*(?:hours?|hrs?|business days?|days?)\b[^.]{0,40}(?:reply|respond|response|back to you))/i;

export function checkResponsePromise(corpus: SiteCorpus): EvidenceEntry {
  const pages = allPages(corpus);
  const sources = pages.map((p) => p.finalUrl).join(", ");
  if (!pages.length) {
    return entry("E-RES-101", "No pages could be fetched", "Not Assessed", "Direct fetch", "Fetch blocked or failed.");
  }

  const promisePages = pages.filter((p) => RESPONSE_PROMISE.test(p.text));
  const links = allPageLinks(corpus);
  const channels = CONVERSION_TYPES.filter((t) => links.some((l) => l.linkType === t));
  const hasForm = allForms(corpus).length > 0;
  const channelNames = [...channels.map(String), ...(hasForm ? ["form"] : [])];

  // A missing promise is an absence claim, so it never becomes a Fail here — the
  // copy could sit in a chat widget or a JS-rendered block. Partial at worst,
  // and the safety rule may downgrade it further.
  let status: ResultStatus;
  if (promisePages.length > 0) status = channelNames.length >= 2 ? "Pass" : "Partial";
  else if (channelNames.length === 0) status = "Not Assessed";
  else status = "Partial";

  const promiseNote = promisePages.length
    ? `A response promise is visible on ${promisePages.length} page(s).`
    : "No response-time or post-submission promise was found in the fetched text; this is not evidence that none is shown to a visitor.";

  // Patch 001.1: a missing response promise IS an absence claim, and promise copy
  // is exactly the sort of thing a chat widget or JS block carries — so this one
  // keeps its protection. Only a promise actually found is presence.
  return {
    ...entry(
      "E-RES-101",
      `${channelNames.length} response channel(s) visible: ${channelNames.join(", ") || "none"}. ` +
        (promisePages.length ? "Response promise present." : "No response promise found in fetched text."),
      status,
      sources,
      `${promiseNote} Channels counted from anchor targets and form markup. No channel was used — nothing was sent, ` +
        `called, messaged or submitted. Post-submission behaviour is not observable without submitting, which is not done.`
    ),
    claimType: promisePages.length > 0 ? "presence" : "absence",
    facts: { channels: channelNames.length, promisePages: promisePages.length },
  };
}

// --- Textual checks (LLM classification, constrained to genuinely fetched text) ---

interface TextualResult {
  results: { evidenceId: string; evidenceValue: string; resultStatus: ResultStatus; observation: string }[];
}

export async function runTextualChecks(corpus: SiteCorpus): Promise<EvidenceEntry[]> {
  const pageContent = corpusAsText(corpus);
  const sources = allPages(corpus).map((p) => p.finalUrl).join(", ");
  if (!pageContent.trim()) {
    return TEXTUAL_IDS.map((id) =>
      entry(id, "No page content available to check", "Not Assessed", "Direct fetch", "Fetch blocked or failed — nothing to read.")
    );
  }

  const items = TEXTUAL_IDS.map((id) => `- ${id}: ${META[id].question}`).join("\n");
  // "fast" tier: reading fetched text against fixed pass/fail questions is
  // classification, not reasoning.
  const res = await llmJson<TextualResult>(
    loadPrompt("evidence-textual", { PAGE_CONTENT: pageContent, EVIDENCE_ITEMS: items }),
    { stage: "Contract 3", promptName: "evidence-textual", tier: "fast" }
  );

  // P1-c: the textual checks are where absence gets asserted, because the LLM
  // only ever sees text a direct fetch could extract. Apply the safety rule to
  // every result before it leaves this function.
  const signals = corpusDynamicSignals(corpus);
  const embeds = corpusEmbedSignals(corpus); // Area D
  return TEXTUAL_IDS.map((id) => {
    const r = res.results.find((x) => x.evidenceId === id);
    if (!r)
      return entry(id, "Check did not return a result", "Not Assessed", sources, "LLM omitted this item — treated honestly as not assessed.");
    const note =
      id === "E-VIS-004"
        ? " Intra-site consistency only — cross-source NAP comparison (directories, GBP, social) is not possible in this run mode."
        : id === "E-SCA-001"
          ? " Publicly visible claim only — structurally self-report; cannot be independently verified here."
          : "";
    return applyZeroAbsentSafetyRule(
      entry(id, r.evidenceValue, r.resultStatus, sources, r.observation + note),
      signals,
      embeds
    );
  });
}

// --- Structurally unreachable checks ---

export function gbpChecks(): EvidenceEntry[] {
  return GBP_IDS.map((id) =>
    entry(
      id,
      "No method available to confirm Google Business Profile status in this run",
      "Not Assessed",
      "N/A",
      "Direct-fetch-only run mode: Google Business Profile surfaces cannot be retrieved without a search/places API. Absence of confirmation is not confirmed absence."
    )
  );
}

export const FIXED_EVIDENCE_IDS = Object.keys(META);
