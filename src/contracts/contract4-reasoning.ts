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
import { allPages, isSiblingTenantUrl } from "../site.js";
import { renderRegulatorContext } from "../types.js";
import type {
  ClientIdentificationPacket,
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
  // Set by the local safety gate (P1-d), never by the model.
  constraintSafety?: ReasoningResult["constraintSafety"];
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

async function reason(
  gm: GoalModel,
  pkg: EvidencePackage,
  cip?: ClientIdentificationPacket
): Promise<CderResponse> {
  // "reasoning" tier: CDER is the core reasoning act of the whole system.
  const res = await llmJson<CderResponse>(
    loadPrompt("cder-reasoning", {
      GOAL_MODEL: renderGoalModel(gm),
      EVIDENCE_PACKAGE: renderEvidence(pkg),
      // Area C2: read straight off the CIP, never carried forward on another object.
      REGULATOR_CONTEXT: renderRegulatorContext(cip),
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

  // Phase 1 (P1-d): Indeterminate joins Not Assessed / Not Applicable as
  // something a constraint may not lean on. An item the static layer flagged as
  // "requires rendered verification" is precisely a check that did not conclude,
  // so citing it as support would restate the failure this patch exists to stop.
  //
  // Area D: Requires Browser Confirmation joins them, and for a sharper reason.
  // Those items concern content a third-party embed draws from another origin,
  // which nothing in this run can execute. A constraint resting on one would be
  // asserting the absence of something we have no means of seeing.
  const UNSAFE_AS_SUPPORT: ReadonlySet<string> = new Set(["Indeterminate", "Requires Browser Confirmation"]);
  const isReportSafeSupport = (id: string) =>
    wasActuallyAssessed(id) && !UNSAFE_AS_SUPPORT.has(byId.get(id)?.resultStatus ?? "");

  const proposedSupport = res.supportingEvidence ?? [];
  const dropped = proposedSupport.filter((r) => !isReportSafeSupport(r.evidenceId)).map((r) => r.evidenceId);
  res.supportingEvidence = proposedSupport.filter((r) => isReportSafeSupport(r.evidenceId));
  // Patch 001.7: this filter used to admit only Fail and Partial, on the
  // assumption that counter-evidence is always a failing check. It is not. The
  // strongest counterweight to "conversion pathways are broken" is a check that
  // PASSED — a working booking route on some page, proving the defect is not
  // universal. Run 004's ESC-001 was exactly that, resolved to Pass, reasoned
  // about correctly in prose, and then stripped from the structured field by this
  // line. The honest test is the same one applied to support: did the check
  // conclude? An Indeterminate or Requires Browser Confirmation item can no more
  // contradict a hypothesis than support one.
  res.contradictoryEvidence = (res.contradictoryEvidence ?? []).filter((r) => isReportSafeSupport(r.evidenceId));

  // The safety gate. A constraint must not rest MAINLY on evidence a direct
  // fetch cannot stand behind — "mainly", not "entirely", because a single
  // surviving tangential item can otherwise keep a withdrawn finding alive.
  // (Observed in replay: Lyle's false zero-metric constraint lost both of its
  // real supports but was still propped up by an unrelated missing-NAP item.)
  // The constraint is not silently deleted — it is kept, marked, and its
  // confidence forced down, so the founder sees the hypothesis AND why it is
  // unproven.
  const mainlyUnsupported = dropped.length > res.supportingEvidence.length;
  if (proposedSupport.length > 0 && mainlyUnsupported) {
    res.hypothesisConfidence = "Low";
    res.constraintSafety = {
      status: "requires-rendered-verification",
      reason:
        `${dropped.length} of ${proposedSupport.length} evidence items cited in support of this constraint were ` +
        "Indeterminate, Requires Browser Confirmation, Not Assessed, or Not Applicable — typically because the page " +
        "carries content rendered after load, or supplied by a third-party embed, that a direct fetch cannot see. " +
        "This constraint is a hypothesis, not a finding, and must be confirmed against the live rendered page — in a " +
        "consumer browser where a third-party embed is involved — before it is reported or delivered.",
      droppedSupportingEvidence: dropped,
    };
    res.reasoningNotes =
      `[CONSTRAINT SAFETY GATE] ${dropped.length} of ${proposedSupport.length} supporting items withdrawn ` +
      `(${dropped.join(", ") || "none cited"}); confidence forced to Low; rendered verification required before this ` +
      `constraint may be reported. ${res.reasoningNotes ?? ""}`.trim();
  }
  return res;
}

export async function runContract4(
  gm: GoalModel,
  pkg: EvidencePackage,
  corpus: SiteCorpus,
  // Area C2: optional and read-only. Supplies sector/regulator-sensitivity so the
  // reasoning prompt can apply compliance-aware wording. Optional keeps every
  // existing caller and test valid.
  cip?: ClientIdentificationPacket
): Promise<{ result: ReasoningResult; pkg: EvidencePackage; escalationTrace: RunLog["escalationTrace"] }> {
  let first = await reason(gm, pkg, cip);
  let finalResponse = first;
  let finalPkg = pkg;
  const escalationTrace: RunLog["escalationTrace"] = { attempted: false };

  // Single Confidence Escalation attempt — a branch, not a loop.
  if (first.hypothesisConfidence !== "High" && first.escalation?.wanted) {
    const fetched = new Set(allPages(corpus).map((p) => p.finalUrl));
    // Phase 1 (P1-e): same host is not the same subject. On a multi-tenant
    // platform every business shares one domain, so the host filter alone will
    // happily offer a competitor's profile as "additional evidence".
    const subjectUrl = corpus.homepage.finalUrl;
    const rejectedSiblings: string[] = [];
    const available = corpus.unfetchedCandidates.filter((u) => {
      if (fetched.has(u)) return false;
      if (isSiblingTenantUrl(subjectUrl, u)) {
        rejectedSiblings.push(u);
        return false;
      }
      return true;
    });
    const siblingNote =
      rejectedSiblings.length > 0
        ? `Excluded ${rejectedSiblings.length} same-host page(s) belonging to a different business on this platform. `
        : "";

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
        escalationTrace.outcome = siblingNote + gathered.outcome;

        finalResponse = await reason(gm, finalPkg, cip);
        escalationTrace.confidenceAfter = finalResponse.hypothesisConfidence;
      } else {
        escalationTrace.outcome = `${siblingNote}Escalation considered but not attempted: ${check.reasoning}`;
      }
    } else {
      escalationTrace.outcome =
        siblingNote +
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
      // P1-d: the gate's verdict must reach the run log and the report, or the
      // whole guard is invisible to the founder.
      ...(finalResponse.constraintSafety ? { constraintSafety: finalResponse.constraintSafety } : {}),
    },
    pkg: finalPkg,
    escalationTrace,
  };
}
