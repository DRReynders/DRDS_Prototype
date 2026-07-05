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
import { collectSiteCorpus } from "./site.js";
import type { RunLog } from "./types.js";
import { randomUUID } from "node:crypto";

export interface PipelineOutcome {
  log: RunLog;
  logFile: string;
}

export type StageEvent = (message: string) => void;

export async function runPipeline(rawUrl: string, onStage?: StageEvent): Promise<PipelineOutcome> {
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
      "Contract 3 — Evidence (fixed 13-item subset)",
      () => runContract3(corpus),
      (r) => `Coverage: ${r.evidenceCoverage.split(" — ")[0]}`
    );

    const c4 = await track(
      "Contract 4 — Reasoning (CDER)",
      () => runContract4(log.goalModel!, log.evidencePackage!, corpus),
      (r) =>
        `${r.result.hypothesisConfidence}${r.escalationTrace?.attempted ? " (after 1 escalation attempt)" : ""}`
    );
    log.reasoningResult = c4.result;
    log.evidencePackage = c4.pkg; // includes any escalation-gathered entry
    log.escalationTrace = c4.escalationTrace;

    log.growthSnapshot = await track("Contract 5 — Growth Snapshot", () => runContract5(log.reasoningResult!));

    return finish(log);
  } catch (err) {
    log.failure ??= {
      stage:
        err instanceof LlmNotConfiguredError
          ? "configuration"
          : err instanceof BudgetExceededError
            ? "budget"
            : "unexpected",
      reason: err instanceof Error ? err.message : String(err),
    };
    return finish(log);
  }
}

function finish(log: RunLog): PipelineOutcome {
  log.finishedAt = new Date().toISOString();
  log.llmUsage = collectUsage();
  return { log, logFile: writeRunLog(log) };
}
