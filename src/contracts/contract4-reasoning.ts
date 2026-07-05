// Contract 4 — Reasoning (ReasoningResult), implementing CDER.
// Promise: reporting never performs reasoning; this stage's output is the single
// source every report draws from. Only this Contract may decide whether
// additional evidence should be sought (Confidence Escalation Principle), and it
// never gathers evidence itself — it requests it from Contract 3.
//
// The escalation loop is HARD-CAPPED AT ONE ATTEMPT in code (MVP Definition §6):
// there is deliberately no loop below, only a single non-repeatable branch. This
// bounds runtime for the public demo, not the principle itself.

import { llmJson, loadPrompt } from "../llm/client.js";
import { requestAdditionalEvidence } from "./contract3-evidence.js";
import type { SiteCorpus } from "../site.js";
import { allPages } from "../site.js";
import type {
  EvidencePackage,
  EvidenceReference,
  GoalModel,
  ReasoningResult,
  RunLog,
} from "../types.js";

interface CderResponse {
  primaryConstraint: string;
  hypothesisConfidence: "High" | "Medium" | "Low";
  supportingEvidence: EvidenceReference[];
  contradictoryEvidence: EvidenceReference[];
  secondaryConstraints: string[];
  reasoningNotes: string;
  escalation: { wanted: boolean; evidenceSought: string; likelyToHelp: string };
}

interface EscalationCheckResponse {
  worthAttempting: boolean;
  evidenceSought: string;
  urlToFetch: string;
  reasoning: string;
}

function renderGoalModel(gm: GoalModel): string {
  return `Business Goal: ${gm.businessGoal}\nExpected Growth Functions: ${gm.expectedGrowthFunctions.join(", ")}\nGoal Model Confidence: ${gm.goalModelConfidence}\nReasoning Basis: ${gm.reasoningBasis}`;
}

function renderEvidence(pkg: EvidencePackage): string {
  const rows = pkg.entries.map(
    (e) =>
      `- ${e.evidenceId} [${e.growthFunction}] — ${e.evidenceValue} (Result Status: ${e.resultStatus}; Source: ${e.source}; Note: ${e.observation})`
  );
  return `${rows.join("\n")}\nAggregate Evidence Coverage: ${pkg.evidenceCoverage}`;
}

async function reason(gm: GoalModel, pkg: EvidencePackage): Promise<CderResponse> {
  // "reasoning" tier: CDER is the core reasoning act of the whole system.
  const res = await llmJson<CderResponse>(
    loadPrompt("cder-reasoning", {
      GOAL_MODEL: renderGoalModel(gm),
      EVIDENCE_PACKAGE: renderEvidence(pkg),
    }),
    { stage: "Contract 4", promptName: "cder-reasoning", tier: "reasoning" }
  );

  // Contract honesty guard (V0.2, Contract 4): Result Status exists to keep
  // "couldn't check" distinct from "checked and found". Neither evidence list
  // may cite Not Assessed / Not Applicable entries — an unperformed check can
  // no more support a hypothesis than contradict one — and both lists may only
  // cite evidence that actually exists.
  const byId = new Map(pkg.entries.map((e) => [e.evidenceId, e]));
  const wasActuallyAssessed = (id: string) => {
    const s = byId.get(id)?.resultStatus;
    return s !== undefined && s !== "Not Assessed" && s !== "Not Applicable";
  };
  res.supportingEvidence = (res.supportingEvidence ?? []).filter((r) => wasActuallyAssessed(r.evidenceId));
  res.contradictoryEvidence = (res.contradictoryEvidence ?? []).filter((r) => {
    const s = byId.get(r.evidenceId)?.resultStatus;
    return s === "Fail" || s === "Partial";
  });
  return res;
}

export async function runContract4(
  gm: GoalModel,
  pkg: EvidencePackage,
  corpus: SiteCorpus
): Promise<{ result: ReasoningResult; pkg: EvidencePackage; escalationTrace: RunLog["escalationTrace"] }> {
  let first = await reason(gm, pkg);
  let finalResponse = first;
  let finalPkg = pkg;
  const escalationTrace: RunLog["escalationTrace"] = { attempted: false };

  // Single Confidence Escalation attempt — a branch, not a loop.
  if (first.hypothesisConfidence !== "High" && first.escalation?.wanted) {
    const fetched = new Set(allPages(corpus).map((p) => p.finalUrl));
    const available = corpus.unfetchedCandidates.filter((u) => !fetched.has(u));

    if (available.length > 0) {
      const check = await llmJson<EscalationCheckResponse>(
        loadPrompt("escalation-check", {
          HYPOTHESIS: first.primaryConstraint,
          CONFIDENCE: first.hypothesisConfidence,
          AVAILABLE_PAGES: available.map((u) => `- ${u}`).join("\n"),
        }),
        { stage: "Contract 4 (escalation check)", promptName: "escalation-check", tier: "reasoning" }
      );

      if (check.worthAttempting && available.includes(check.urlToFetch)) {
        escalationTrace.attempted = true;
        escalationTrace.evidenceSought = check.evidenceSought;
        escalationTrace.urlFetched = check.urlToFetch;
        escalationTrace.confidenceBefore = first.hypothesisConfidence;

        const gathered = await requestAdditionalEvidence(pkg, check.urlToFetch, check.evidenceSought);
        finalPkg = gathered.pkg;
        escalationTrace.outcome = gathered.outcome;

        finalResponse = await reason(gm, finalPkg);
        escalationTrace.confidenceAfter = finalResponse.hypothesisConfidence;
      } else {
        escalationTrace.outcome = `Escalation considered but not attempted: ${check.reasoning}`;
      }
    } else {
      escalationTrace.outcome =
        "Escalation wanted, but no additional publicly observable page was reachable in this run mode — concluded honestly with available evidence.";
    }
  }

  const escalationNote = escalationTrace.attempted
    ? ` [Confidence Escalation trial: sought "${escalationTrace.evidenceSought}" via ${escalationTrace.urlFetched}; outcome: ${escalationTrace.outcome}; confidence ${escalationTrace.confidenceBefore} -> ${escalationTrace.confidenceAfter}.]`
    : escalationTrace.outcome
      ? ` [Confidence Escalation: ${escalationTrace.outcome}]`
      : "";

  return {
    result: {
      // Carried forward from GoalModel in code — never re-derived by the LLM.
      businessGoal: gm.businessGoal,
      expectedGrowthFunctions: gm.expectedGrowthFunctions,
      primaryConstraint: finalResponse.primaryConstraint,
      hypothesisConfidence: finalResponse.hypothesisConfidence,
      evidenceCoverage: finalPkg.evidenceCoverage, // inherited aggregate, not recalculated
      supportingEvidence: finalResponse.supportingEvidence,
      contradictoryEvidence: finalResponse.contradictoryEvidence,
      secondaryConstraints: finalResponse.secondaryConstraints ?? [],
      reasoningNotes: (finalResponse.reasoningNotes ?? "") + escalationNote,
    },
    pkg: finalPkg,
    escalationTrace,
  };
}
