// The fixed evidence subset for the public prototype (MVP Definition §6),
// hardcoded by design. Grounded in what Sprint 1A proved valuable. Selection,
// ranking, or dynamic choice of evidence items is future work — do not add it
// here; a smarter Evidence Engine over the full 119-item library comes later.

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
  if (!claimsAbsenceOrZero(entry.evidenceValue)) return entry;

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
  return entry(
    "E-VIS-016",
    https
      ? `Site loads successfully over HTTPS (${hp.finalUrl})`
      : `Site did not load cleanly over HTTPS (status ${hp.status}${hp.error ? `, ${hp.error}` : ""})`,
    https ? "Pass" : "Fail",
    "Direct fetch",
    "Node.js rejects invalid/expired certificates by default, so a successful HTTPS fetch implies a valid certificate."
  );
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
  return entry(
    "E-VIS-001",
    `${pages.length} pages checked: ${missing} missing titles, ${duplicated ? "duplicates present" : "all unique"}. Examples: ${titles.filter(Boolean).slice(0, 3).join(" | ")}`,
    status,
    pages.map((p) => p.finalUrl).join(", "),
    `Checked across the ${pages.length} distinct fetched core pages only, not the full site.${canonicalNote}`
  );
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
  return entry(
    "E-VIS-002",
    `${pages.length} pages checked: ${missing} missing meta descriptions, ${duplicated ? "duplicates present" : "no duplicates"}.`,
    status,
    pages.map((p) => p.finalUrl).join(", "),
    `Checked across the ${pages.length} distinct fetched core pages only.${canonicalNote}`
  );
}

export function checkH1s(corpus: SiteCorpus): EvidenceEntry {
  const pages = allPages(corpus);
  if (!pages.length)
    return entry("E-VIS-003", "No pages could be fetched", "Not Assessed", "Direct fetch", "Fetch blocked or failed.");
  const bad = pages.filter((p) => p.h1s.length !== 1);
  const status: ResultStatus = bad.length === 0 ? "Pass" : bad.length === pages.length ? "Fail" : "Partial";
  return entry(
    "E-VIS-003",
    `${pages.length} pages checked: ${bad.length} with missing or multiple H1s. Example H1s: ${pages.flatMap((p) => p.h1s).slice(0, 3).join(" | ")}`,
    status,
    pages.map((p) => p.finalUrl).join(", "),
    "Heading structure below H1 not assessed — H1 presence/uniqueness only."
  );
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

  return entry(
    "E-VIS-041",
    `Core page types found via homepage navigation: ${found.join(", ") || "none"} (${found.length} of ${wanted.length} expected types matched by URL pattern)`,
    status,
    corpus.homepage.finalUrl,
    `Assessed from link URLs discovered on the homepage — pages linked only from deeper navigation may be missed.${slugNote}`
  );
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
