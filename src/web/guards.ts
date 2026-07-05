// Public-exposure guards: per-IP rate limiting (in-memory) and a daily spend
// cap (one flat JSON file per day). Deliberately no database and no external
// service — bounded, inspectable, and sufficient for one-request-at-a-time.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const RUNS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "runs");

// --- Per-IP rate limit ---

const hits = new Map<string, number[]>();

export function rateLimitCheck(ip: string): { allowed: boolean; message?: string } {
  const perHour = Number(process.env.RATE_LIMIT_RUNS_PER_HOUR || 4);
  if (perHour <= 0) return { allowed: true };
  const now = Date.now();
  const windowStart = now - 3_600_000;
  const recent = (hits.get(ip) ?? []).filter((t) => t > windowStart);
  if (recent.length >= perHour) {
    hits.set(ip, recent);
    return {
      allowed: false,
      message:
        "You've reached the limit of Growth Snapshots for this hour. Please try again a little later.",
    };
  }
  recent.push(now);
  hits.set(ip, recent);
  // Bound memory: drop stale IPs occasionally.
  if (hits.size > 5000) {
    for (const [k, v] of hits) if (!v.some((t) => t > windowStart)) hits.delete(k);
  }
  return { allowed: true };
}

// --- Daily spend cap (soft, checked before starting a run) ---

function spendFile(): string {
  const day = new Date().toISOString().slice(0, 10);
  return join(RUNS_DIR, `spend-${day}.json`);
}

export function dailySpendUsd(): number {
  try {
    return (JSON.parse(readFileSync(spendFile(), "utf8")) as { totalUsd: number }).totalUsd || 0;
  } catch {
    return 0;
  }
}

export function recordSpend(usd: number): void {
  mkdirSync(RUNS_DIR, { recursive: true });
  const total = dailySpendUsd() + usd;
  writeFileSync(spendFile(), JSON.stringify({ totalUsd: Number(total.toFixed(6)) }), "utf8");
}

export function dailyBudgetCheck(): { allowed: boolean; message?: string } {
  const limit = Number(process.env.MAX_DAILY_COST_USD || 0);
  if (!limit || limit <= 0) return { allowed: true };
  if (dailySpendUsd() >= limit) {
    return {
      allowed: false,
      message:
        "We've reached today's capacity for free Growth Snapshots. Please come back tomorrow — nothing is wrong with your website.",
    };
  }
  return { allowed: true };
}
