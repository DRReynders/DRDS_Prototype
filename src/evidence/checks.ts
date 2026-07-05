// The fixed evidence subset for the public prototype (MVP Definition §6),
// hardcoded by design. Grounded in what Sprint 1A proved valuable. Selection,
// ranking, or dynamic choice of evidence items is future work — do not add it
// here; a smarter Evidence Engine over the full 119-item library comes later.

import { llmJson, loadPrompt } from "../llm/client.js";
import { allPages, corpusAsText, type SiteCorpus } from "../site.js";
import type { EvidenceEntry, ResultStatus } from "../types.js";

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
  const pages = allPages(corpus);
  if (!pages.length)
    return entry("E-VIS-001", "No pages could be fetched", "Not Assessed", "Direct fetch", "Fetch blocked or failed.");
  const titles = pages.map((p) => p.title);
  const missing = titles.filter((t) => !t).length;
  const unique = new Set(titles.filter(Boolean)).size;
  const duplicated = unique < titles.filter(Boolean).length;
  const status: ResultStatus = missing === 0 && !duplicated ? "Pass" : missing === titles.length ? "Fail" : "Partial";
  return entry(
    "E-VIS-001",
    `${pages.length} pages checked: ${missing} missing titles, ${duplicated ? "duplicates present" : "all unique"}. Examples: ${titles.filter(Boolean).slice(0, 3).join(" | ")}`,
    status,
    pages.map((p) => p.finalUrl).join(", "),
    `Checked across the ${pages.length} fetched core pages only, not the full site.`
  );
}

export function checkMetaDescriptions(corpus: SiteCorpus): EvidenceEntry {
  const pages = allPages(corpus);
  if (!pages.length)
    return entry("E-VIS-002", "No pages could be fetched", "Not Assessed", "Direct fetch", "Fetch blocked or failed.");
  const descs = pages.map((p) => p.metaDescription);
  const missing = descs.filter((d) => !d).length;
  const unique = new Set(descs.filter(Boolean)).size;
  const duplicated = unique < descs.filter(Boolean).length;
  const status: ResultStatus = missing === 0 && !duplicated ? "Pass" : missing === descs.length ? "Fail" : "Partial";
  return entry(
    "E-VIS-002",
    `${pages.length} pages checked: ${missing} missing meta descriptions, ${duplicated ? "duplicates present" : "no duplicates"}.`,
    status,
    pages.map((p) => p.finalUrl).join(", "),
    `Checked across the ${pages.length} fetched core pages only.`
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
  const status: ResultStatus = found.length >= 4 ? "Pass" : found.length >= 2 ? "Partial" : "Fail";
  return entry(
    "E-VIS-041",
    `Core page types found via homepage navigation: ${found.join(", ") || "none"} (${found.length} of ${wanted.length} expected types)`,
    status,
    corpus.homepage.finalUrl,
    "Assessed from link URLs discovered on the homepage — pages linked only from deeper navigation may be missed."
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
    return entry(id, r.evidenceValue, r.resultStatus, sources, r.observation + note);
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
