// Public-exposure guards: client-identity derivation, per-IP rate limiting
// (in-memory) and a daily spend budget (one flat JSON file per day).
// Deliberately no database and no external service — bounded, inspectable, and
// sufficient for one-request-at-a-time.
//
// What the daily budget IS, stated plainly so no one relies on more than it
// offers: a SOFT, BEST-EFFORT, PER-CONTAINER daily application budget that fails
// closed when its configuration or the current container's accounting state is
// invalid. It is NOT a hard cap, NOT global across instances, and NOT persistent
// across a Railway redeploy — a redeploy starts a fresh ledger and therefore a
// fresh day's allowance. It is checked before a run starts, so a run already in
// flight can overshoot by roughly one run's cost.
//
// These guards sit ABOVE the provider layer on purpose: nothing here knows or
// cares which model vendor served a run. Cost arrives as a plain USD number.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const RUNS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "runs");

// --- Client identity ---
//
// This service runs behind Railway's proxy, so the socket peer is the proxy, not
// the visitor. Railway's public-networking documentation states that it supplies
// the client's remote address in `X-Real-IP`, so that is the platform contract
// this code uses.
//
// `X-Forwarded-For` is deliberately NOT consulted. It is caller-controlled, and
// reasoning about which position in that chain is trustworthy means inferring
// trusted-hop semantics rather than using a contract that actually exists.

function stripPort(address: string): string {
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(address);
  if (bracketed) return bracketed[1];
  // Only an IPv4:port pair — a bare IPv6 address is full of colons and must not
  // have its last group mistaken for a port.
  if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(address)) return address.slice(0, address.lastIndexOf(":"));
  return address;
}

// Collapse an IPv6 address to its /64 prefix. Still justified with X-Real-IP:
// this is not about header spoofing but about the visitor's own address space —
// a single residential allocation is typically a /64 or larger, so keying on the
// full address would let one visitor mint a fresh rate-limit identity per
// request without any spoofing at all.
// Returns null for anything that is not a syntactically valid IPv6 address.
function ipv6Prefix(address: string): string | null {
  if (!address.includes(":")) return null;
  const halves = address.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  // An embedded IPv4 tail is handled before this point; anything else with a dot
  // is not a plain IPv6 address.
  if ([...head, ...tail].some((g) => g.includes("."))) return null;
  let groups: string[];
  if (halves.length === 2) {
    const missing = 8 - head.length - tail.length;
    if (missing < 0) return null;
    groups = [...head, ...Array<string>(missing).fill("0"), ...tail];
  } else {
    groups = head;
  }
  // Every group must be real hex. An empty group here means malformed input
  // such as ":1:2:3:4:5:6:7" — the `::` expansion above only ever inserts "0".
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  const prefix = groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, ""));
  return `${prefix.join(":")}::/64`;
}

const IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;
const IPV6_PREFIX = /^[0-9a-f]{1,4}(?::[0-9a-f]{1,4}){3}::\/64$/;

// One canonical form per client, so trivial reformatting cannot manufacture a
// second identity. Lenient: an unrecognisable value is passed through
// lowercased rather than discarded, because a socket address we do not
// recognise is still a key worth counting. Use parseIpAddress() when the input
// is untrusted and validity actually matters.
export function normaliseAddress(raw: string): string {
  let address = raw.trim().toLowerCase();
  if (!address) return "";
  address = stripPort(address);
  const zone = address.indexOf("%");
  if (zone > 0) address = address.slice(0, zone);
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(address);
  if (mapped) return mapped[1];
  return ipv6Prefix(address) ?? address;
}

/** Strict form: returns the canonical key only for a syntactically valid IPv4 or
 *  IPv6 address, otherwise null. Used to decide whether a header is usable. */
export function parseIpAddress(raw: string): string | null {
  const canonical = normaliseAddress(raw);
  if (!canonical) return null;
  if (IPV4.test(canonical)) return canonical;
  if (IPV6_PREFIX.test(canonical)) return canonical;
  return null;
}

let clientIpSourceReported = false;

/** Test seam: forget that the client-IP source has already been reported. */
export function resetClientIpDiagnostic(): void {
  clientIpSourceReported = false;
}

// Rate-limit identity. Prefers Railway's documented X-Real-IP; falls back to the
// socket peer when that header is absent or not a valid address. Never consults
// X-Forwarded-For.
//
// Pure enough to exercise without booting an HTTP server: it takes the raw
// header and the raw socket address rather than an IncomingMessage.
export function deriveClientKey(
  realIpHeader: string | string[] | undefined,
  socketAddress: string | undefined,
  onDiagnostic?: (line: string) => void
): string {
  const header = Array.isArray(realIpHeader) ? realIpHeader[0] : realIpHeader;
  const headerPresent = typeof header === "string" && header.trim().length > 0;
  const fromHeader = headerPresent ? parseIpAddress(header) : null;

  // One bounded line per process describing WHICH SOURCE was used — never an
  // address. Enough to confirm after deployment that Railway is supplying
  // X-Real-IP as documented, and to notice immediately if it is not.
  if (!clientIpSourceReported) {
    clientIpSourceReported = true;
    onDiagnostic?.(
      "PV_CLIENT_IP_SOURCE " +
        JSON.stringify({
          source: fromHeader ? "x-real-ip" : "socket",
          realIpHeaderPresent: headerPresent,
          realIpUsable: fromHeader !== null,
          ...(fromHeader ? {} : { note: "falling back to the socket peer — behind a proxy this may be shared" }),
        })
    );
  }

  if (fromHeader) return fromHeader;
  return normaliseAddress(socketAddress ?? "") || "unknown";
}

// --- Per-IP rate limit ---

const DEFAULT_RUNS_PER_HOUR = 4;
const WINDOW_MS = 3_600_000;

const hits = new Map<string, number[]>();

export interface RateLimitConfig {
  runsPerHour: number; // 0 = deliberately disabled
  detail: string; // operator-facing only, never shown to a visitor
}

// Unparseable configuration must fall back to the documented default, never to
// "no limit" — the old `Number(x) || 4` shape turned a typo such as "four" into
// NaN, and `length >= NaN` is always false, silently disabling the limit.
// `0` stays a real, documented way to switch the limit off.
export function readRateLimitConfig(): RateLimitConfig {
  const raw = (process.env.RATE_LIMIT_RUNS_PER_HOUR ?? "").trim();
  if (!raw) return { runsPerHour: DEFAULT_RUNS_PER_HOUR, detail: `not set — default ${DEFAULT_RUNS_PER_HOUR}/hour` };
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    return {
      runsPerHour: DEFAULT_RUNS_PER_HOUR,
      detail: `invalid — falling back to the default ${DEFAULT_RUNS_PER_HOUR}/hour`,
    };
  }
  if (value === 0) return { runsPerHour: 0, detail: "0 — per-IP limit deliberately disabled" };
  const runsPerHour = Math.max(1, Math.floor(value));
  return { runsPerHour, detail: `${runsPerHour}/hour` };
}

// Stage 1.2. Recovering an already-completed Snapshot is a disk read, not a
// paid computation, so it must not spend the visitor's 4-per-hour paid
// allowance — otherwise a broken connection would cost them the very retries
// they need. It still needs SOME control, because the lookup scans run logs.
//
// A named bucket keeps the two counters completely separate while reusing one
// rolling-window implementation. `paid` is the historical behaviour and the
// default, so every existing caller is unchanged.
export interface RateLimitBucket {
  /** Namespace for the counter. Different buckets never share an allowance. */
  bucket?: string;
  /** Overrides the configured per-hour limit. Used only by non-paid buckets. */
  runsPerHour?: number;
}

export function rateLimitCheck(
  ip: string,
  options: RateLimitBucket = {}
): { allowed: boolean; message?: string } {
  const runsPerHour = options.runsPerHour ?? readRateLimitConfig().runsPerHour;
  if (runsPerHour <= 0) return { allowed: true };
  const key = options.bucket ? `${options.bucket}:${ip}` : ip;
  const now = Date.now();
  const windowStart = now - WINDOW_MS;
  const recent = (hits.get(key) ?? []).filter((t) => t > windowStart);
  if (recent.length >= runsPerHour) {
    hits.set(key, recent);
    // Tell them roughly when their oldest hit falls out of the rolling window,
    // rather than a vague "later" — a real ETA reads as intentional, not stuck.
    const retryMinutes = Math.max(1, Math.ceil((recent[0] + WINDOW_MS - now) / 60_000));
    return {
      allowed: false,
      // Deliberately no CTA mention here — the client appends a real,
      // clickable Strategy Call link for this state (see GRACEFUL_FALLBACK_STATES
      // in index.html). Keeping it out of this string avoids saying it twice.
      message:
        `You've reached the limit for instant Growth Snapshots from this connection. ` +
        `Try again in about ${retryMinutes} minute${retryMinutes === 1 ? "" : "s"}.`,
    };
  }
  recent.push(now);
  hits.set(key, recent);
  // Bound memory: drop stale IPs occasionally.
  if (hits.size > 5000) {
    for (const [k, v] of hits) if (!v.some((t) => t > windowStart)) hits.delete(k);
  }
  return { allowed: true };
}

/** Test seam: forget every recorded hit. */
export function resetRateLimit(): void {
  hits.clear();
}

// --- Daily spend ledger ---

function spendFile(): string {
  const day = new Date().toISOString().slice(0, 10);
  return join(RUNS_DIR, `spend-${day}.json`);
}

// Two different situations that the old `catch { return 0 }` collapsed into one:
//
//   No ledger for today   — legitimate. This container has recorded no spend
//                           today, so today's spend really is zero.
//   Unreadable ledger     — NOT zero. It means we do not KNOW today's spend, and
//                           a safety control must not treat unknown as "nothing
//                           spent, go ahead".
export type SpendLedger = { known: true; totalUsd: number } | { known: false; reason: string };

// `file` is a test seam only — production always uses today's ledger path.
export function readSpendLedger(file: string = spendFile()): SpendLedger {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch (err) {
    // ENOENT covers both "no ledger yet today" and "no runs directory yet".
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return { known: true, totalUsd: 0 };
    return { known: false, reason: "today's spend ledger could not be read" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { known: false, reason: "today's spend ledger is not valid JSON" };
  }
  const total = (parsed as { totalUsd?: unknown } | null)?.totalUsd;
  if (typeof total !== "number" || !Number.isFinite(total) || total < 0) {
    return { known: false, reason: "today's spend ledger is malformed" };
  }
  return { known: true, totalUsd: total };
}

export interface SpendRecordResult {
  recorded: boolean;
  reason?: string;
}

// Adds a completed run's cost to today's ledger. Returns a result rather than
// throwing: this is called AFTER a Snapshot has already been produced, and a
// bookkeeping failure must never destroy a finished result the visitor is
// waiting for.
export function recordSpend(usd: number, file: string = spendFile()): SpendRecordResult {
  const ledger = readSpendLedger(file);
  if (!ledger.known) {
    // Do not overwrite a ledger we could not read. Replacing it would silently
    // discard the day's recorded spend and hand back a full allowance — exactly
    // the fail-open behaviour this pass removes. Leaving it intact keeps the
    // budget check refusing runs until an operator looks at it.
    return { recorded: false, reason: ledger.reason };
  }
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ totalUsd: Number((ledger.totalUsd + usd).toFixed(6)) }), "utf8");
    return { recorded: true };
  } catch {
    return { recorded: false, reason: "today's spend ledger could not be written" };
  }
}

// --- Daily budget configuration ---

export interface DailyBudgetConfig {
  ok: boolean;
  limitUsd: number; // meaningful only when ok
  detail: string; // operator-facing only, never shown to a visitor
}

// Reads and VALIDATES the configured daily budget. The old shape,
// `Number(process.env.MAX_DAILY_COST_USD || 0)` followed by
// `if (!limit || limit <= 0) return { allowed: true }`, treated absent,
// malformed, zero and negative values as "no cap" — so the single control
// bounding public spend disappeared silently whenever configuration was wrong.
//
// A valid, positive, finite number is REQUIRED. There is no textual escape and
// no uncapped mode: the product has a deliberately chosen budget, and the
// safety contract stays simple. The production value lives in the environment;
// nothing here hard-codes it.
export function readDailyBudgetConfig(): DailyBudgetConfig {
  const raw = (process.env.MAX_DAILY_COST_USD ?? "").trim();
  if (!raw) {
    return { ok: false, limitUsd: 0, detail: "MAX_DAILY_COST_USD is not set." };
  }
  const value = Number(raw);
  // The raw value is never echoed back: a malformed setting can contain
  // anything, and this string reaches the server log.
  if (!Number.isFinite(value)) {
    return { ok: false, limitUsd: 0, detail: "MAX_DAILY_COST_USD is not a finite number." };
  }
  if (value <= 0) {
    return { ok: false, limitUsd: 0, detail: "MAX_DAILY_COST_USD must be greater than 0." };
  }
  return { ok: true, limitUsd: value, detail: `${value} USD/day.` };
}

// --- Daily budget decision ---

export type BudgetOutcome =
  | { allowed: true }
  | { allowed: false; state: "daily_capacity" | "unavailable"; message: string };

// Shown when the service refuses to start a run because its own configuration or
// accounting state is not usable. Says nothing about cost, budgets, providers,
// configuration or infrastructure — none of which is the visitor's concern, and
// none of which they could act on.
export const UNAVAILABLE_MESSAGE =
  "The Growth Snapshot is temporarily unavailable. Please try again later.";

function unavailable(): BudgetOutcome {
  return { allowed: false, state: "unavailable", message: UNAVAILABLE_MESSAGE };
}

// Pure decision, separated from reading the environment and the ledger so both
// halves can be exercised without touching real accounting.
export function evaluateDailyBudget(config: DailyBudgetConfig, ledger: SpendLedger): BudgetOutcome {
  // Fail CLOSED on either unknown. A public endpoint that spends real money on
  // every request may not run while the control bounding that spend is missing,
  // nor while this container cannot tell how much it has already spent today.
  if (!config.ok) return unavailable();
  if (!ledger.known) return unavailable();
  if (ledger.totalUsd >= config.limitUsd) {
    return {
      allowed: false,
      state: "daily_capacity",
      message:
        "We've reached today's capacity for Growth Snapshots. Please try again tomorrow — this isn't a reflection of your business, simply a temporary capacity limit.",
    };
  }
  return { allowed: true };
}

export function dailyBudgetCheck(): BudgetOutcome {
  const config = readDailyBudgetConfig();
  // The ledger is only consulted once the configuration is known good — an
  // unreadable budget refuses the run regardless of what has been spent.
  if (!config.ok) return unavailable();
  return evaluateDailyBudget(config, readSpendLedger());
}

/** One operator-facing line describing how the public guards are configured and
 *  whether this container can account for today's spend. Logged at startup, and
 *  again whenever a request is refused for either reason, so a misconfigured or
 *  broken deploy is visible in the log viewer rather than only to the visitor
 *  who was turned away. */
export function guardConfigSummary(): { ok: boolean; summary: string } {
  const budget = readDailyBudgetConfig();
  const rate = readRateLimitConfig();
  const ledger = budget.ok ? readSpendLedger() : null;
  const ledgerOk = ledger === null || ledger.known;
  const ok = budget.ok && ledgerOk;
  // No log prefix here — each call site tags it, so a startup line and a
  // refusal line stay distinguishable in the log viewer.
  return {
    ok,
    summary:
      `${ok ? "OK" : "FAIL-CLOSED"} — daily budget: ${budget.detail} rate limit: ${rate.detail}.` +
      (ledger && !ledger.known ? ` Accounting: ${ledger.reason}.` : "") +
      (ok
        ? ""
        : ` Growth Snapshot requests will be refused until MAX_DAILY_COST_USD is a positive number` +
          ` and today's spend ledger is readable.`),
  };
}
