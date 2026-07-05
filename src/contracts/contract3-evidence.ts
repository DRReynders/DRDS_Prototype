// Contract 3 — Evidence (EvidencePackage).
// Promise: the Reasoning Engine never receives raw research — always structured
// evidence. This stage alone gathers evidence; Contract 4 may request one
// additional gather via requestAdditionalEvidence, but never fetches anything
// itself.

import {
  checkCorePageCoverage,
  checkH1s,
  checkMetaDescriptions,
  checkSsl,
  checkTitles,
  gbpChecks,
  runTextualChecks,
} from "../evidence/checks.js";
import { fetchPage } from "../fetcher.js";
import { llmJson, loadPrompt } from "../llm/client.js";
import type { SiteCorpus } from "../site.js";
import type { EvidenceEntry, EvidencePackage, ResultStatus } from "../types.js";

function aggregateCoverage(entries: EvidenceEntry[]): string {
  const assessed = entries.filter(
    (e) => e.resultStatus !== "Not Assessed" && e.resultStatus !== "Not Applicable"
  ).length;
  const total = entries.length;
  const label = assessed >= total * 0.75 ? "Substantial" : assessed >= total * 0.4 ? "Partial" : "Thin";
  return `${label} — ${assessed} of ${total} evidence items could actually be assessed; the rest are honestly recorded as Not Assessed.`;
}

export async function runContract3(corpus: SiteCorpus): Promise<EvidencePackage> {
  const entries: EvidenceEntry[] = [
    checkSsl(corpus),
    checkTitles(corpus),
    checkMetaDescriptions(corpus),
    checkH1s(corpus),
    checkCorePageCoverage(corpus),
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
