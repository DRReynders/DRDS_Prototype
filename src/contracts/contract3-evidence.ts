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
import type { EvidenceEntry, EvidencePackage, ResultStatus } from "../types.js";

// Area D: "Requires Browser Confirmation" joins Not Assessed / Not Applicable as
// unresolved. It is an open question about a third-party embed, not a result —
// counting it as assessed would inflate coverage on exactly the checks the embed
// rule exists to hold open.
function aggregateCoverage(entries: EvidenceEntry[]): string {
  const unresolved: EvidenceEntry["resultStatus"][] = [
    "Not Assessed",
    "Not Applicable",
    "Requires Browser Confirmation",
  ];
  const assessed = entries.filter((e) => !unresolved.includes(e.resultStatus)).length;
  const awaitingBrowser = entries.filter((e) => e.resultStatus === "Requires Browser Confirmation").length;
  const total = entries.length;
  const label = assessed >= total * 0.75 ? "Substantial" : assessed >= total * 0.4 ? "Partial" : "Thin";
  const browserNote = awaitingBrowser
    ? ` ${awaitingBrowser} of those await consumer-browser confirmation of third-party embedded content and must not be reported as absent.`
    : "";
  return (
    `${label} — ${assessed} of ${total} evidence items could actually be assessed; the rest are honestly recorded as ` +
    `Not Assessed.${browserNote} ${perGrowthFunctionCoverage(entries, unresolved)}`
  );
}

// Area A1: an aggregate count hides which growth functions were never tested.
// Run 001 reported "10 of 14 assessed" while Capture and Response — two of the
// five functions its own Goal Model named — had zero items. True, and useless.
function perGrowthFunctionCoverage(
  entries: EvidenceEntry[],
  unresolved: EvidenceEntry["resultStatus"][]
): string {
  const byFn = new Map<string, { assessed: number; total: number }>();
  for (const e of entries) {
    // Composite labels ("Discoverability / Credibility") count toward both.
    for (const fn of e.growthFunction.split("/").map((s) => s.trim()).filter(Boolean)) {
      if (fn === "(escalation)") continue;
      const row = byFn.get(fn) ?? { assessed: 0, total: 0 };
      row.total++;
      if (!unresolved.includes(e.resultStatus)) row.assessed++;
      byFn.set(fn, row);
    }
  }
  if (byFn.size === 0) return "";
  const parts = [...byFn.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([fn, r]) => `${fn} ${r.assessed}/${r.total}`);
  return `By growth function: ${parts.join(", ")}.`;
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
    const res = await llmJson<{
      results: { evidenceId: string; evidenceValue: string; resultStatus: ResultStatus; observation: string }[];
    }>(
      loadPrompt("evidence-textual", {
        PAGE_CONTENT: `===== PAGE: ${page.finalUrl} =====\nTITLE: ${page.title}\nBODY TEXT:\n${page.text}`,
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
