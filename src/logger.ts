// Run log: one flat JSON file per run, for direct file inspection only.
// Deliberately no database, no tables, no viewer (MVP Definition §6).

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { RunLog } from "./types.js";

const RUNS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "runs");

export function writeRunLog(log: RunLog): string {
  mkdirSync(RUNS_DIR, { recursive: true });
  const safeId = log.input.normalisedBusinessIdentifier.replace(/[^a-z0-9.-]/gi, "_") || "invalid-input";
  const file = join(RUNS_DIR, `${log.startedAt.replace(/[:.]/g, "-")}_${safeId}.json`);
  writeFileSync(file, JSON.stringify(log, null, 2), "utf8");
  return file;
}

// Flat-file lookup by runId (newest first, bounded) — deliberately no database.
export function findRunLogByRunId(runId: string): { log: RunLog; file: string } | null {
  if (!/^[0-9a-f-]{36}$/i.test(runId)) return null;
  let names: string[];
  try {
    names = readdirSync(RUNS_DIR).filter((n) => n.endsWith(".json")).sort().reverse().slice(0, 200);
  } catch {
    return null;
  }
  for (const name of names) {
    try {
      const file = join(RUNS_DIR, name);
      const log = JSON.parse(readFileSync(file, "utf8")) as RunLog;
      if (log.runId === runId) return { log, file };
    } catch {
      /* unreadable file — skip */
    }
  }
  return null;
}

export function updateRunLog(file: string, log: RunLog): void {
  writeFileSync(file, JSON.stringify(log, null, 2), "utf8");
}
