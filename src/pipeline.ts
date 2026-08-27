// The canonical pipeline: Contracts 0 -> 1 -> 2 -> 3 -> 4 -> 5, in fixed order,
// synchronous, one run at a time. Callable with no web interface (this module is
// the seam the web layer calls).
//
// Observability lives here, at orchestrator level only: each stage reports
// started / completed / failed, duration, and its Contract's own confidence
// field where one exists. The Contract modules themselves are unaware of it.

import { runContract0 } from "./contracts/contract0-input.js";
import { CannotIdentifyError, runContract1 } from "./contracts/contract1-cip.js";
import { runContract2 } from "./contracts/contract2-goalmodel.js";
import { runContract3 } from "./contracts/contract3-evidence.js";
import { runContract4 } from "./contracts/contract4-reasoning.js";
import { runContract5 } from "./contracts/contract5-snapshot.js";
import { loadEnv } from "./llm/client.js";
import { LlmNotConfiguredError } from "./llm/provider.js";
import { beginUsageCollection, BudgetExceededError, collectUsage } from "./llm/usage.js";
import { writeRunLog } from "./logger.js";
import { buildPublicSnapshot } from "./projection/public-snapshot.js";
import { collectSiteCorpus } from "./site.js";
import type { RunLog } from "./types.js";
import { randomUUID } from "node:crypto";

export interface PipelineOutcome {
  log: RunLog;
  logFile: string;
}

export type StageEvent = (message: string) => void;

/** Reports the run's canonical id the moment it exists, before any fetch or
 *  provider call. Stage 1.2: the browser needs the id EARLY, because a stream
 *  that breaks mid-run can only be recovered by asking for that same run —
 *  and a run whose id the client never learned is a paid computation nobody
 *  can collect. */
export type RunIdEvent = (runId: string) => void;

export async function runPipeline(
  rawUrl: string,
  onStage?: StageEvent,
  onRunId?: RunIdEvent
): Promise<PipelineOutcome> {
  loadEnv();
  beginUsageCollection(); // per-run token/cost records (safe: one run at a time)
  const emit: StageEvent = (m) => onStage?.(m);
  const log: RunLog = {
    runId: randomUUID(),
    startedAt: new Date().toISOString(),
    input: undefined as unknown as RunLog["input"],
    pagesFetched: [],
    stages: [],
  };
  // One id, generated once, above. Everything downstream — the run_started
  // event, the run log filename's contents, PV_RUN_SUMMARY, the terminal
  // result and the recovery route — reads this same field. There is no second
  // identifier for a run anywhere in the system.
  onRunId?.(log.runId);

  // Runs one stage with started/completed/failed + duration + confidence
  // reporting. Purely observational — adds no behaviour to any Contract.
  async function track<T>(
    stage: string,
    fn: () => Promise<T>,
    confidenceOf?: (result: T) => string | undefined
  ): Promise<T> {
    emit(`${stage} — started`);
    const startedAt = new Date().toISOString();
    const t0 = performance.now();
    try {
      const result = await fn();
      const durationMs = Math.round(performance.now() - t0);
      const confidence = confidenceOf?.(result);
      log.stages.push({ stage, status: "completed", startedAt, durationMs, confidence });
      emit(
        `${stage} — completed in ${(durationMs / 1000).toFixed(1)}s${confidence ? ` (confidence: ${confidence})` : ""}`
      );
      return result;
    } catch (err) {
      const durationMs = Math.round(performance.now() - t0);
      const detail = err instanceof Error ? err.message : String(err);
      log.stages.push({ stage, status: "failed", startedAt, durationMs, detail });
      emit(`${stage} — FAILED after ${(durationMs / 1000).toFixed(1)}s: ${detail}`);
      throw err;
    }
  }

  try {
    const c0 = await track(
      "Contract 0 — Business Input (normalise + reachability)",
      () => runContract0(rawUrl),
      (r) => (r.input.normalisationStatus === "Success" ? "Normalisation: Success" : "Normalisation: Failed")
    );
    log.input = c0.input;
    if (c0.input.normalisationStatus === "Failed" || !c0.homepage) {
      log.failure = { stage: "Contract 0", reason: c0.input.normalisationNotes };
      return finish(log);
    }
    log.pagesFetched.push({ url: c0.homepage.url, status: c0.homepage.status, error: c0.homepage.error });

    const corpus = await track("Site corpus — fetching core pages", () => collectSiteCorpus(c0.homepage!));
    for (const p of corpus.internalPages) {
      log.pagesFetched.push({ url: p.url, status: p.status, error: p.error });
    }
    log.robots = { disallows: corpus.robotsDisallows, blockedUrls: corpus.robotsBlockedUrls };

    try {
      log.cip = await track(
        "Contract 1 — Client Identification (CIP)",
        () => runContract1(c0.input.normalisedBusinessIdentifier, corpus),
        (r) => r.identificationConfidence
      );
    } catch (err) {
      if (err instanceof CannotIdentifyError) {
        // Honest inability to identify — reported, never guessed around.
        log.failure = { stage: "Contract 1", reason: err.message };
        return finish(log);
      }
      throw err;
    }

    log.goalModel = await track(
      "Contract 2 — Goal Model",
      () => runContract2(log.cip!),
      (r) => r.goalModelConfidence
    );

    log.evidencePackage = await track(
      "Contract 3 — Evidence (fixed 17-item subset)",
      () => runContract3(corpus),
      (r) => `Coverage: ${r.evidenceCoverage.split(" — ")[0]}`
    );

    // The public product, built here and nowhere else.
    //
    // It is assembled at the END OF THE OBSERVATION LAYER, before any reasoning
    // stage runs, which is what makes the boundary structural rather than
    // editorial: at this point in the pipeline no constraint exists to leak.
    // Deterministic and free — no model call, no provider, no budget impact.
    //
    // Contracts 4 and 5 still run after this (Stage 1 of the approved plan) and
    // still write to the run log. They no longer decide anything a stranger
    // sees.
    log.publicSnapshot = buildPublicSnapshot({
      input: log.input,
      cip: log.cip!,
      evidence: log.evidencePackage,
      pagesFetched: log.pagesFetched,
      robots: log.robots,
    });

    // ── THE FAILURE BOUNDARY (Stage 1.1) ───────────────────────────────────
    //
    // Everything from here on is INTERNAL. The public product already exists
    // and cost nothing to build, so a failure below must not destroy it.
    //
    // Before this boundary, one try/catch wrapped Contracts 0-5 and set
    // `log.failure` for any of them. A provider outage during Contract 4 —
    // reasoning the visitor is not buying and will never see — therefore
    // replaced a finished Growth Snapshot with a generic error page.
    //
    // These stages get their own catch, writing `log.internalFailure` instead.
    // `log.failure` keeps its original, narrower meaning: the PUBLIC product
    // could not be produced. Pre-projection failure semantics are untouched.
    try {
      const c4 = await track(
        "Contract 4 — Reasoning (CDER)",
        // Area C2 (Council-authorised narrow exception): the CIP is passed through
        // so regulator-sensitivity stays sourced from one place rather than being
        // duplicated onto GoalModel and ReasoningResult. Read-only context.
        () => runContract4(log.goalModel!, log.evidencePackage!, corpus, log.cip),
        (r) =>
          `${r.result.hypothesisConfidence}${r.escalationTrace?.attempted ? " (after 1 escalation attempt)" : ""}`
      );
      log.reasoningResult = c4.result;
      log.evidencePackage = c4.pkg; // includes any escalation-gathered entry
      log.escalationTrace = c4.escalationTrace;
    } catch (err) {
      log.internalFailure = internalFailureOf("Contract 4", err);
    }

    // Contract 5 is skipped entirely when Contract 4 did not produce a
    // ReasoningResult. It writes copy ABOUT a constraint, so with no constraint
    // there is nothing for it to write — and inventing a substitute diagnosis is
    // precisely what must never happen.
    if (log.reasoningResult) {
      try {
        log.growthSnapshot = await track("Contract 5 — Growth Snapshot", () =>
          runContract5(log.reasoningResult!, log.cip)
        );
      } catch (err) {
        log.internalFailure = internalFailureOf("Contract 5", err);
      }
    }

    return finish(log);
  } catch (err) {
    // Reached only for failures BEFORE the public projection exists. Unchanged.
    log.failure ??= { stage: classifyFailure(err), reason: reasonOf(err) };
    return finish(log);
  }
}

/** How a thrown error is named in a run log. Shared by both catches so the two
 *  paths can never classify the same outage differently. */
function classifyFailure(err: unknown): "configuration" | "budget" | "unexpected" {
  if (err instanceof LlmNotConfiguredError) return "configuration";
  if (err instanceof BudgetExceededError) return "budget";
  return "unexpected";
}

function reasonOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** An internal-stage failure, named by the Contract that threw and by the kind
 *  of outage it was. Both are internal-only: no caller may show either to a
 *  visitor, and nothing here is consulted when building the public payload. */
function internalFailureOf(stage: string, err: unknown): { stage: string; reason: string } {
  return { stage, reason: `${classifyFailure(err)}: ${reasonOf(err)}` };
}

function finish(log: RunLog): PipelineOutcome {
  log.finishedAt = new Date().toISOString();
  log.llmUsage = collectUsage();
  return { log, logFile: writeRunLog(log) };
}
