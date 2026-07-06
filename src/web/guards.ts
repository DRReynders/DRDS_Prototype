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
    // Tell them roughly when their oldest hit falls out of the rolling window,
    // rather than a vague "later" — a real ETA reads as intentional, not stuck.
    const retryMinutes = Math.max(1, Math.ceil((recent[0] + 3_600_000 - now) / 60_000));
    return {
      allowed: false,
      // Deliberately no CTA mention here — the client appends a real,
      // clickable Strategy Call link for this state (see GRACEFUL_FALLBACK_STATES
      // in index.html). Keeping it out of this string avoids saying it twice.
      message:
        `You've reached today's limit for instant Growth Audits from this connection. ` +
        `Try again in about ${retryMinutes} minute${retryMinutes === 1 ? "" : "s"}.`,
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
        "We've reached today's capacity for Growth Audits. Please try again tomorrow — this isn't a reflection of your business, simply a temporary capacity limit.",
    };
  }
  return { allowed: true };
}
