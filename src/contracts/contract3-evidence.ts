// Contract 3 — Evidence (EvidencePackage).
// Promise: the Reasoning Engine never receives raw research — always structured
// evidence. This stage alone gathers evidence; Contract 4 may request one
// additional gather via requestAdditionalEvidence, but never fetches anything
// itself.

import {
  applyZeroAbsentSafetyRule,
  checkContactForm,
  checkConversionDestinations,
  checkCorePageCoverage,
  checkH1s,
  checkMetaDescriptions,
  checkPrimaryCta,
  checkResponsePromise,
  checkSsl,
  checkTitles,
  corpusDynamicSignals,
  corpusEmbedSignals,
  gbpChecks,
  runTextualChecks,
} from "../evidence/checks.js";
import { fetchPage } from "../fetcher.js";
import { llmJson, loadPrompt } from "../llm/client.js";
import type { SiteCorpus } from "../site.js";
import { renderPageLinkInventory } from "../types.js";
import type { EvidenceEntry, EvidencePackage, ResultStatus } from "../types.js";

// Patch 001.2 — coverage semantics.
//
// Coverage answers three different questions and used to blur them into one
// number. Run 002 reported "Capture 3/3" while one of those three items was
// Indeterminate — a check that ran and did not conclude. True as arithmetic,
// misleading as a statement about what we know.
//
//   USABLE     — the check reached a conclusion something can be built on.
//                Pass, Partial, Fail.
//   ATTEMPTED  — a method existed and the check actually looked. Usable plus
//                Indeterminate and Requires Browser Confirmation, which were both
//                attempted and simply did not resolve.
//   UNRESOLVED — attempted without conclusion (Indeterminate, Requires Browser
//                Confirmation) or never reachable at all (Not Assessed, Not
//                Applicable).
//
// Only USABLE may appear as a numerator against evidence strength. Indeterminate
// is still counted as attempted, because pretending the check never ran would be
// its own dishonesty.
const USABLE_STATUSES: ResultStatus[] = ["Pass", "Partial", "Fail"];
// Attempted but inconclusive — distinct from never having had a method.
const ATTEMPTED_UNRESOLVED: ResultStatus[] = ["Indeterminate", "Requires Browser Confirmation"];

function isUsable(s: ResultStatus): boolean {
  return USABLE_STATUSES.includes(s);
}
function wasAttempted(s: ResultStatus): boolean {
  return isUsable(s) || ATTEMPTED_UNRESOLVED.includes(s);
}

// Exported so Patch 001.2 can test coverage semantics directly against fixture
// entries, with no pipeline run and no LLM call.
export function aggregateCoverage(entries: EvidenceEntry[]): string {
  const total = entries.length;
  const usable = entries.filter((e) => isUsable(e.resultStatus)).length;
  const indeterminate = entries.filter((e) => e.resultStatus === "Indeterminate").length;
  const awaitingBrowser = entries.filter((e) => e.resultStatus === "Requires Browser Confirmation").length;
  const notAssessed = entries.filter(
    (e) => e.resultStatus === "Not Assessed" || e.resultStatus === "Not Applicable"
  ).length;

  const label = usable >= total * 0.75 ? "Substantial" : usable >= total * 0.4 ? "Partial" : "Thin";

  const unresolvedParts: string[] = [];
  if (indeterminate) unresolvedParts.push(`${indeterminate} indeterminate (checked, did not conclude)`);
  if (awaitingBrowser)
    unresolvedParts.push(
      `${awaitingBrowser} awaiting consumer-browser confirmation of third-party embedded content, which must not be reported as absent`
    );
  if (notAssessed) unresolvedParts.push(`${notAssessed} not assessed (no method available in this run)`);
  const unresolvedNote = unresolvedParts.length ? ` Unresolved: ${unresolvedParts.join("; ")}.` : "";

  return (
    `${label} — ${usable} of ${total} evidence items produced a usable result (Pass, Partial or Fail).` +
    `${unresolvedNote} ${perGrowthFunctionCoverage(entries)}`
  );
}

// Area A1 + Patch 001.2: an aggregate count hides which growth functions were
// never tested, and a single ratio hides which were tested without concluding.
// Run 001 reported "10 of 14 assessed" while Capture and Response — two of the
// five functions its own Goal Model named — had zero items. True, and useless.
function perGrowthFunctionCoverage(entries: EvidenceEntry[]): string {
  const byFn = new Map<string, { usable: number; attempted: number }>();
  for (const e of entries) {
    // Composite labels ("Discoverability / Credibility") count toward both.
    for (const fn of e.growthFunction.split("/").map((s) => s.trim()).filter(Boolean)) {
      if (fn === "(escalation)") continue;
      const row = byFn.get(fn) ?? { usable: 0, attempted: 0 };
      if (wasAttempted(e.resultStatus)) row.attempted++;
      if (isUsable(e.resultStatus)) row.usable++;
      byFn.set(fn, row);
    }
  }
  if (byFn.size === 0) return "";
  const parts = [...byFn.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([fn, r]) => `${fn} ${r.usable}/${r.attempted}`);
  return `By growth function (usable/attempted — attempted excludes checks with no method in this run): ${parts.join(", ")}.`;
}

export async function runContract3(corpus: SiteCorpus): Promise<EvidencePackage> {
  // Area A1: the Capture/Response checks assert absence in places conversion
  // controls are commonly injected client-side, so they pass through the same
  // safety rule as every other absence claim rather than asserting a false zero.
  const signals = corpusDynamicSignals(corpus);
  const embeds = corpusEmbedSignals(corpus);
  const captureResponse = [
    checkPrimaryCta(corpus),
    checkConversionDestinations(corpus),
    checkContactForm(corpus),
    checkResponsePromise(corpus),
  ].map((e) => applyZeroAbsentSafetyRule(e, signals, embeds));

  const entries: EvidenceEntry[] = [
    checkSsl(corpus),
    checkTitles(corpus),
    checkMetaDescriptions(corpus),
    checkH1s(corpus),
    checkCorePageCoverage(corpus),
    ...captureResponse,
    ...(await runTextualChecks(corpus)),
    ...gbpChecks(),
  ];
  return { entries, evidenceCoverage: aggregateCoverage(entries) };
}

// The single evidence-gathering method Contract 4 may request during its one
// Confidence Escalation attempt: a direct fetch of one not-yet-examined page,
// checked for one specific thing. Still Contract 3 doing the gathering.
export async function requestAdditionalEvidence(
  pkg: EvidencePackage,
  url: string,
  evidenceSought: string
): Promise<{ pkg: EvidencePackage; outcome: string }> {
  const page = await fetchPage(url);
  let newEntry: EvidenceEntry;

  if (page.error || page.status >= 400) {
    newEntry = {
      evidenceId: "ESC-001",
      growthFunction: "(escalation)",
      evidenceType: "Observation",
      evidenceValue: `Requested page could not be fetched (${page.error ?? `HTTP ${page.status}`})`,
      resultStatus: "Not Assessed",
      source: url,
      evidenceAccessibility: "Publicly Observable",
      observation: `Escalation sought: ${evidenceSought}. The attempt was made and honestly failed — it did not reduce uncertainty.`,
    };
  } else {
    const linkInventory = renderPageLinkInventory(page.pageLinks ?? []);
    const res = await llmJson<{
      results: { evidenceId: string; evidenceValue: string; resultStatus: ResultStatus; observation: string }[];
    }>(
      loadPrompt("evidence-textual", {
        // Patch 001.5: escalation used to see visible text only. An href is not
        // text, so a question about a CTA's destination was unanswerable even
        // though the answer had already been extracted. Appending the bounded
        // link inventory costs no fetch and no extra call. Pages without a
        // pageLinks inventory render an empty string and behave exactly as before.
        PAGE_CONTENT:
          `===== PAGE: ${page.finalUrl} =====\nTITLE: ${page.title}\nBODY TEXT:\n${page.text}` +
          (linkInventory ? `\n\n${linkInventory}` : ""),
        EVIDENCE_ITEMS: `- ESC-001: ${evidenceSought}`,
      }),
      { stage: "Contract 3 (escalation gather)", promptName: "evidence-textual", tier: "fast" }
    );
    const r = res.results[0];
    newEntry = {
      evidenceId: "ESC-001",
      growthFunction: "(escalation)",
      evidenceType: "Observation",
      evidenceValue: r?.evidenceValue ?? "No result returned",
      resultStatus: r?.resultStatus ?? "Not Assessed",
      source: page.finalUrl,
      evidenceAccessibility: "Publicly Observable",
      observation: `Gathered during the single Confidence Escalation attempt. Sought: ${evidenceSought}. ${r?.observation ?? ""}`,
    };
  }

  const entries = [...pkg.entries, newEntry];
  return {
    pkg: { entries, evidenceCoverage: aggregateCoverage(entries) },
    outcome: `${newEntry.resultStatus}: ${newEntry.evidenceValue}`,
  };
}
