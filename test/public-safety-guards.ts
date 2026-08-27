// Public Snapshot safety guards — fail-closed cost configuration, fail-closed
// spend accounting, and platform-contract rate-limit identity.
// No network, no LLM calls, no cost. Run: npx tsx test/public-safety-guards.ts
//
// Three weaknesses are under test, all found by the Phase 1/2 Technical Gate:
//
//   1. The daily cost budget FAILED OPEN. `Number(env || 0)` followed by
//      `if (!limit || limit <= 0) return allowed` meant an absent, blank,
//      malformed, zero or negative setting silently removed the only control
//      bounding public spend — the malformed case being the dangerous one,
//      because the variable still looks present in the dashboard.
//
//   2. Spend accounting caught EVERY read error and returned 0. A corrupt
//      ledger therefore read as "nothing spent today, go ahead".
//
//   3. The rate-limit key came from caller-controlled `X-Forwarded-For`.
//      Identity now comes from Railway's documented `X-Real-IP`, and the
//      forwarded chain is not consulted at all.
//
// Ledger tests write fixtures to a throwaway OS temp directory via the file
// seam; the repository's own `runs/` accounting is never read or written.

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  deriveClientKey,
  evaluateDailyBudget,
  normaliseAddress,
  parseIpAddress,
  rateLimitCheck,
  readDailyBudgetConfig,
  readRateLimitConfig,
  readSpendLedger,
  recordSpend,
  resetClientIpDiagnostic,
  resetRateLimit,
  UNAVAILABLE_MESSAGE,
  type DailyBudgetConfig,
  type SpendLedger,
} from "../src/web/guards.js";

let failed = 0;
function check(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond || !detail ? "" : `  -> ${detail}`}`);
  if (!cond) failed++;
}

const ORIGINAL_BUDGET = process.env.MAX_DAILY_COST_USD;
const ORIGINAL_RATE = process.env.RATE_LIMIT_RUNS_PER_HOUR;

function withBudget(value: string | undefined, fn: () => void): void {
  if (value === undefined) delete process.env.MAX_DAILY_COST_USD;
  else process.env.MAX_DAILY_COST_USD = value;
  fn();
}
function withRate(value: string | undefined, fn: () => void): void {
  if (value === undefined) delete process.env.RATE_LIMIT_RUNS_PER_HOUR;
  else process.env.RATE_LIMIT_RUNS_PER_HOUR = value;
  fn();
}

const KNOWN = (totalUsd: number): SpendLedger => ({ known: true, totalUsd });
const UNKNOWN: SpendLedger = { known: false, reason: "test" };

// ────────────────────────────────────────────────────────────────
console.log("=== 1. Daily budget configuration must fail closed ===");

const INVALID: [label: string, value: string | undefined][] = [
  ["absent", undefined],
  ["empty string", ""],
  ["whitespace only", "   "],
  ["not a number", "five"],
  ["currency-prefixed", "$5.00"],
  ["comma decimal", "5,00"],
  ["trailing unit", "5.00 USD"],
  ["zero", "0"],
  ["zero with decimals", "0.00"],
  ["negative", "-5"],
  ["NaN literal", "NaN"],
  ["Infinity", "Infinity"],
  ["negative Infinity", "-Infinity"],
  ["textual unlimited", "unlimited"],
  ["textual UNLIMITED", "UNLIMITED"],
  ["textual none", "none"],
  ["textual off", "off"],
];

for (const [label, value] of INVALID) {
  withBudget(value, () => {
    const config = readDailyBudgetConfig();
    check(`invalid budget rejected: ${label}`, config.ok === false, `ok=${config.ok}`);
    const outcome = evaluateDailyBudget(config, KNOWN(0));
    check(
      `invalid budget refuses the run: ${label}`,
      outcome.allowed === false && outcome.state === "unavailable",
      JSON.stringify(outcome)
    );
  });
}

console.log("\n=== 2. Only a positive finite number is accepted ===");

withBudget("5.00", () => {
  const c = readDailyBudgetConfig();
  check("5.00 parses", c.ok === true && c.limitUsd === 5, JSON.stringify(c));
});
withBudget("  5.00  ", () => {
  const c = readDailyBudgetConfig();
  check("surrounding whitespace tolerated", c.ok === true && c.limitUsd === 5, JSON.stringify(c));
});
withBudget("0.50", () => {
  const c = readDailyBudgetConfig();
  check("sub-dollar budget parses", c.ok === true && c.limitUsd === 0.5, JSON.stringify(c));
});
withBudget("25", () => {
  const c = readDailyBudgetConfig();
  check("integer budget parses", c.ok === true && c.limitUsd === 25, JSON.stringify(c));
});

console.log("\n=== 3. There is no uncapped mode ===");
// The `unlimited` escape hatch was removed on Aeris review. Nothing textual,
// blank, or malformed may produce an unbounded budget.
for (const [label, value] of INVALID) {
  withBudget(value, () => {
    const c = readDailyBudgetConfig();
    check(`\`${label}\` yields no usable budget`, c.ok === false, JSON.stringify(c));
  });
}
withBudget("unlimited", () => {
  const outcome = evaluateDailyBudget(readDailyBudgetConfig(), KNOWN(0));
  check(
    "`unlimited` now fails closed rather than uncapping",
    outcome.allowed === false && outcome.state === "unavailable",
    JSON.stringify(outcome)
  );
});

console.log("\n=== 4. Budget exhaustion refuses before any model work ===");

const valid: DailyBudgetConfig = { ok: true, limitUsd: 5, detail: "test" };
check("spend below budget is allowed", evaluateDailyBudget(valid, KNOWN(4.99)).allowed === true);
const atLimit = evaluateDailyBudget(valid, KNOWN(5));
check(
  "spend exactly at budget is refused",
  atLimit.allowed === false && atLimit.state === "daily_capacity",
  JSON.stringify(atLimit)
);
const over = evaluateDailyBudget(valid, KNOWN(5.4));
check("spend over budget is refused", over.allowed === false && over.state === "daily_capacity");
check("zero spend is allowed", evaluateDailyBudget(valid, KNOWN(0)).allowed === true);

console.log("\n=== 5. Unknown accounting state fails closed ===");

const unknownLedger = evaluateDailyBudget(valid, UNKNOWN);
check(
  "a ledger we cannot read refuses the run",
  unknownLedger.allowed === false && unknownLedger.state === "unavailable",
  JSON.stringify(unknownLedger)
);
check(
  "unknown accounting is NOT reported as at-capacity",
  !(unknownLedger.allowed === false && unknownLedger.state === "daily_capacity")
);
check(
  "unknown accounting refuses even with a generous budget",
  evaluateDailyBudget({ ok: true, limitUsd: 1_000_000, detail: "t" }, UNKNOWN).allowed === false
);

console.log("\n=== 6. Spend ledger: missing vs broken ===");

const tmp = mkdtempSync(join(tmpdir(), "drds-guards-"));
try {
  const missing = join(tmp, "spend-absent.json");
  const absent = readSpendLedger(missing);
  check("absent ledger is a legitimate zero", absent.known === true && absent.totalUsd === 0, JSON.stringify(absent));

  const noDir = join(tmp, "no-such-dir", "spend.json");
  const absentDir = readSpendLedger(noDir);
  check("absent runs directory is a legitimate zero", absentDir.known === true && absentDir.totalUsd === 0);

  const good = join(tmp, "spend-good.json");
  writeFileSync(good, JSON.stringify({ totalUsd: 1.234567 }), "utf8");
  const readGood = readSpendLedger(good);
  check("well-formed ledger is read", readGood.known === true && readGood.totalUsd === 1.234567);

  const recordedZero = join(tmp, "spend-zero.json");
  writeFileSync(recordedZero, JSON.stringify({ totalUsd: 0 }), "utf8");
  const readZero = readSpendLedger(recordedZero);
  check("an explicitly recorded zero is still known", readZero.known === true && readZero.totalUsd === 0);

  const BROKEN: [label: string, contents: string][] = [
    ["truncated JSON", '{"totalUsd": 1.2'],
    ["empty file", ""],
    ["whitespace only", "   \n"],
    ["not an object", "42"],
    ["null", "null"],
    ["missing key", '{"total": 1.2}'],
    ["string value", '{"totalUsd": "1.2"}'],
    ["null value", '{"totalUsd": null}'],
    ["NaN-ish value", '{"totalUsd": "NaN"}'],
    ["negative total", '{"totalUsd": -3}'],
    ["not JSON at all", "totalUsd=1.2"],
  ];
  for (const [label, contents] of BROKEN) {
    const f = join(tmp, `spend-broken-${label.replace(/\W+/g, "-")}.json`);
    writeFileSync(f, contents, "utf8");
    const ledger = readSpendLedger(f);
    check(`broken ledger is unknown, not zero: ${label}`, ledger.known === false, JSON.stringify(ledger));
    check(
      `broken ledger refuses the run: ${label}`,
      evaluateDailyBudget(valid, ledger).allowed === false,
      JSON.stringify(ledger)
    );
  }

  // A directory where a file is expected is a real, non-ENOENT read error.
  const dirPath = join(tmp, "spend-is-a-directory.json");
  mkdirSync(dirPath, { recursive: true });
  const dirLedger = readSpendLedger(dirPath);
  check("unreadable ledger (a directory) is unknown, not zero", dirLedger.known === false, JSON.stringify(dirLedger));

  console.log("\n=== 7. Recording spend never destroys a ledger or a result ===");

  const fresh = join(tmp, "spend-fresh.json");
  check("recording onto an absent ledger succeeds", recordSpend(0.2, fresh).recorded === true);
  const afterFirst = readSpendLedger(fresh);
  check("...and starts the day at that amount", afterFirst.known === true && afterFirst.totalUsd === 0.2);
  recordSpend(0.199, fresh);
  const afterSecond = readSpendLedger(fresh);
  check("...and accumulates", afterSecond.known === true && afterSecond.totalUsd === 0.399, JSON.stringify(afterSecond));

  const corrupt = join(tmp, "spend-corrupt.json");
  writeFileSync(corrupt, "{not json", "utf8");
  const refusedWrite = recordSpend(0.2, corrupt);
  check("recording onto a corrupt ledger is refused", refusedWrite.recorded === false, JSON.stringify(refusedWrite));
  check("...with a reason for the operator", (refusedWrite.reason ?? "").length > 0);
  check("...and the corrupt ledger is NOT overwritten", readSpendLedger(corrupt).known === false);

  const unwritable = join(tmp, "unwritable-dir");
  mkdirSync(unwritable, { recursive: true });
  const writeFail = recordSpend(0.2, unwritable); // path is a directory
  check("a failed ledger write returns a result rather than throwing", writeFail.recorded === false);
  check("...and names the failure for the operator", (writeFail.reason ?? "").length > 0, JSON.stringify(writeFail));
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log("\n=== 8. Refusals stay honest and leak nothing ===");

const refusalText = UNAVAILABLE_MESSAGE;
for (const forbidden of [
  "MAX_DAILY",
  "USD",
  "cost",
  "cap",
  "budget",
  "API",
  "config",
  "variable",
  "Anthropic",
  "claude",
  "model",
  "provider",
  "Railway",
  "ledger",
  "$",
  "NaN",
  "undefined",
  "error",
]) {
  check(`unavailable copy does not mention "${forbidden}"`, !refusalText.toLowerCase().includes(forbidden.toLowerCase()), refusalText);
}
check("unavailable copy is short and plain", refusalText.length < 90 && refusalText.length > 20, refusalText);
check("unavailable copy promises no time or percentage", !/\b(minute|second|hour|ETA)\b|%/i.test(refusalText));
check(
  "unavailable copy is the ratified sentence",
  refusalText === "The Growth Snapshot is temporarily unavailable. Please try again later.",
  refusalText
);

const capacityText = atLimit.allowed === false ? atLimit.message : "";
check(
  "at-capacity wording is the reviewed line",
  capacityText.startsWith("We've reached today's capacity for Growth Snapshots."),
  capacityText
);
// Re-anchored by the observation-boundary pass: "Growth Audit" is a retired
// product name, and this string is forwarded verbatim to the public site.
check("at-capacity refusal uses the current product name", !/Growth Audit/i.test(capacityText), capacityText);
check("at-capacity refusal names no figure", !/\d/.test(capacityText), capacityText);

withBudget("sk-should-never-appear", () => {
  const c = readDailyBudgetConfig();
  check("raw invalid value is never echoed in detail", !c.detail.includes("sk-should-never-appear"), c.detail);
});

// ────────────────────────────────────────────────────────────────
console.log("\n=== 9. Rate-limit configuration must not silently disable itself ===");

withRate(undefined, () => check("absent -> default 4", readRateLimitConfig().runsPerHour === 4));
withRate("", () => check("empty -> default 4", readRateLimitConfig().runsPerHour === 4));
withRate("four", () => check("unparseable -> default 4, NOT disabled", readRateLimitConfig().runsPerHour === 4));
withRate("-1", () => check("negative -> default 4, NOT disabled", readRateLimitConfig().runsPerHour === 4));
withRate("10", () => check("explicit 10 honoured", readRateLimitConfig().runsPerHour === 10));
withRate("0.5", () => check("fractional never rounds down to disabled", readRateLimitConfig().runsPerHour === 1));
withRate("0", () => check("explicit 0 still disables (documented contract)", readRateLimitConfig().runsPerHour === 0));

// ────────────────────────────────────────────────────────────────
console.log("\n=== 10. Client identity comes from X-Real-IP ===");

const REAL = "196.25.1.1";
const SOCKET = "10.0.0.7";

resetClientIpDiagnostic();
check("valid X-Real-IP is preferred over the socket peer", deriveClientKey(REAL, SOCKET) === REAL);
check("X-Real-IP with a port is normalised", deriveClientKey("196.25.1.1:51234", SOCKET) === REAL);
check("X-Real-IP is trimmed and lowercased", deriveClientKey("  196.25.1.1  ", SOCKET) === REAL);
check("array-form header takes the first value", deriveClientKey([REAL, "1.2.3.4"], SOCKET) === REAL);

console.log("\n--- invalid or absent X-Real-IP falls back to the socket peer ---");
const NOT_ADDRESSES = ["", "   ", "not-an-address", "999.999.999.999", "1.2.3", "1.2.3.4.5", "::gggg", "<script>"];
for (const bad of NOT_ADDRESSES) {
  check(`invalid X-Real-IP "${bad || "(blank)"}" -> socket peer`, deriveClientKey(bad, SOCKET) === SOCKET);
}
check("absent X-Real-IP -> socket peer", deriveClientKey(undefined, SOCKET) === SOCKET);
check("absent header and absent socket -> 'unknown'", deriveClientKey(undefined, undefined) === "unknown");
check("socket peer is normalised too", deriveClientKey(undefined, "::ffff:10.0.0.7") === SOCKET);

console.log("\n--- X-Forwarded-For is not an identity source at all ---");
// The handler passes only req.headers["x-real-ip"], so a forwarded chain cannot
// reach this function. These assert the contract from the caller's side: a
// caller who controls XFF cannot change the derived identity.
check(
  "a spoofed forwarded chain in the header position is rejected as invalid",
  deriveClientKey("1.2.3.4, 196.25.1.1", SOCKET) === SOCKET
);
check(
  "...and cannot smuggle an address through X-Real-IP",
  deriveClientKey("196.25.9.9, 196.25.1.1", SOCKET) === SOCKET
);
const spoofAttempts = new Set(
  Array.from({ length: 250 }, (_, i) => deriveClientKey(`10.9.${i % 251}.${i % 251}, ${REAL}`, SOCKET))
);
check("250 chain-shaped spoof attempts all collapse to the socket peer", spoofAttempts.size === 1 && spoofAttempts.has(SOCKET));

console.log("\n=== 11. Address normalisation closes formatting bypasses ===");

check("port stripped from IPv4", normaliseAddress("196.25.1.1:51234") === REAL);
check("IPv4-mapped IPv6 unwrapped", normaliseAddress("::ffff:196.25.1.1") === REAL);
check("IPv4-mapped IPv6 unwrapped (uppercase)", normaliseAddress("::FFFF:196.25.1.1") === REAL);
check("mapped and bare IPv4 are one identity", normaliseAddress("::ffff:196.25.1.1") === normaliseAddress(REAL));

const compressed = normaliseAddress("2001:db8:1:2::1");
check("IPv6 collapses to its /64 prefix", compressed === "2001:db8:1:2::/64", compressed);
check("expanded IPv6 yields the same key", normaliseAddress("2001:0db8:0001:0002:0000:0000:0000:0009") === compressed);
check("bracketed IPv6 with port yields the same key", normaliseAddress("[2001:db8:1:2::abcd]:443") === compressed);
check("zone id stripped, same key", normaliseAddress("2001:db8:1:2::5%eth0") === compressed);
check("different /64 is a different identity", normaliseAddress("2001:db8:1:3::1") !== compressed);

check("parseIpAddress accepts valid IPv4", parseIpAddress("196.25.1.1") === REAL);
check("parseIpAddress accepts valid IPv6", parseIpAddress("2001:db8:1:2::1") === compressed);
check("parseIpAddress rejects out-of-range octets", parseIpAddress("256.1.1.1") === null);
check("parseIpAddress rejects short IPv4", parseIpAddress("1.2.3") === null);
check("parseIpAddress rejects free text", parseIpAddress("not-an-address") === null);
check("parseIpAddress rejects a malformed IPv6", parseIpAddress(":1:2:3:4:5:6:7") === null);
check("parseIpAddress rejects a mapped IPv6 with bad octets", parseIpAddress("::ffff:999.1.1.1") === null);

// A visitor with a routed IPv6 allocation cannot mint identities by walking the
// host portion of their own prefix — still relevant with X-Real-IP, because this
// is about the visitor's real address space, not about header spoofing.
const v6Rotated = new Set(
  Array.from({ length: 250 }, (_, i) => deriveClientKey(`2001:db8:1:2::${i.toString(16)}`, SOCKET))
);
check("250 IPv6 host-portion rotations collapse to one identity", v6Rotated.size === 1, `distinct: ${v6Rotated.size}`);

// ────────────────────────────────────────────────────────────────
console.log("\n=== 12. Limiter behaviour end to end ===");

withRate("3", () => {
  resetRateLimit();
  const key = deriveClientKey(REAL, SOCKET);
  const results = [1, 2, 3, 4].map(() => rateLimitCheck(key));
  check("legitimate requests allowed up to the limit", results.slice(0, 3).every((r) => r.allowed === true));
  check("the request past the limit is refused", results[3].allowed === false);
  const msg = results[3].message ?? "";
  check("refusal carries a real retry window", /Try again in about \d+ minute/.test(msg), msg);
  check("refusal invents no percentage or progress", !/%|\bprogress\b/i.test(msg), msg);

  // Chain-shaped headers are invalid, so each falls back to the socket peer:
  // one shared identity, not 40 fresh ones. The socket key is separate from the
  // real client's key and is itself limited, so the caller gains at most one
  // ordinary allowance rather than an unbounded supply of identities.
  const rotatedKeys = new Set(Array.from({ length: 40 }, (_, i) => deriveClientKey(`5.5.5.${i}, ${REAL}`, SOCKET)));
  check("40 chain-shaped headers yield exactly one identity", rotatedKeys.size === 1, `distinct: ${rotatedKeys.size}`);
  check("...which is the socket peer, not the spoofed value", rotatedKeys.has(SOCKET));
  const rotated = Array.from({ length: 40 }, (_, i) =>
    rateLimitCheck(deriveClientKey(`5.5.5.${i}, ${REAL}`, SOCKET))
  );
  check(
    "...and they share one ordinary allowance rather than minting 40",
    rotated.filter((r) => r.allowed).length === 3,
    `allowed: ${rotated.filter((r) => r.allowed).length}`
  );
});

withRate("3", () => {
  resetRateLimit();
  const a = deriveClientKey("196.25.1.1", SOCKET);
  const b = deriveClientKey("196.25.9.9", SOCKET);
  check("two genuinely different clients get different keys", a !== b);
  [1, 2, 3].forEach(() => rateLimitCheck(a));
  check("exhausting one client does not affect another", rateLimitCheck(b).allowed === true);
});

withRate("0", () => {
  resetRateLimit();
  const many = Array.from({ length: 25 }, () => rateLimitCheck(REAL));
  check("explicit 0 disables the limit as documented", many.every((r) => r.allowed === true));
});

withRate("four", () => {
  resetRateLimit();
  const many = Array.from({ length: 10 }, () => rateLimitCheck(REAL));
  check(
    "a typo'd limit still limits (fell back to 4, did not disable)",
    many.filter((r) => r.allowed).length === 4
  );
});

// ────────────────────────────────────────────────────────────────
console.log("\n=== 13. One-time client-IP source diagnostic, no addresses ===");

resetClientIpDiagnostic();
const lines: string[] = [];
deriveClientKey(REAL, SOCKET, (l) => lines.push(l));
deriveClientKey(REAL, SOCKET, (l) => lines.push(l));
deriveClientKey("bad", SOCKET, (l) => lines.push(l));
check("diagnostic is emitted exactly once per process", lines.length === 1, `${lines.length} lines`);
check("diagnostic reports the source", lines[0]?.includes('"source":"x-real-ip"'), lines[0]);
check("diagnostic reports header presence", lines[0]?.includes('"realIpHeaderPresent":true'), lines[0]);
check("diagnostic reports usability", lines[0]?.includes('"realIpUsable":true'), lines[0]);
check("diagnostic logs no address", !lines[0]?.includes(REAL) && !lines[0]?.includes(SOCKET), lines[0]);

resetClientIpDiagnostic();
const fallbackLines: string[] = [];
deriveClientKey(undefined, SOCKET, (l) => fallbackLines.push(l));
check("socket fallback is signalled", fallbackLines[0]?.includes('"source":"socket"'), fallbackLines[0]);
check("...with header absence recorded", fallbackLines[0]?.includes('"realIpHeaderPresent":false'), fallbackLines[0]);
check("...and still logs no address", !fallbackLines[0]?.includes(SOCKET), fallbackLines[0]);

resetClientIpDiagnostic();
const invalidLines: string[] = [];
deriveClientKey("not-an-address", SOCKET, (l) => invalidLines.push(l));
check(
  "an unusable header is signalled as present-but-unusable",
  invalidLines[0]?.includes('"realIpHeaderPresent":true') && invalidLines[0]?.includes('"realIpUsable":false'),
  invalidLines[0]
);

// ────────────────────────────────────────────────────────────────
console.log("\n=== 14. Guards stay above the provider layer ===");

const guardsSource = await import("node:fs").then((fs) =>
  fs.readFileSync(new URL("../src/web/guards.ts", import.meta.url), "utf8")
);
for (const vendor of ["anthropic", "openai", "claude-", "@anthropic-ai", "gpt-"]) {
  check(`guards.ts names no model vendor: "${vendor}"`, !guardsSource.toLowerCase().includes(vendor));
}
check("guards.ts opens no database/cache client", !/\b(sqlite|postgres|redis|mongo|prisma)\b/i.test(guardsSource));
check("cost still arrives as a plain USD number", /spentUsd|totalUsd: number/.test(guardsSource));
check("no uncapped mode survives in the source", !/UNLIMITED_BUDGET/.test(guardsSource));

// Comments explain WHY the forwarded chain is not trusted, so strip them before
// asserting that no code path actually reads it.
const stripComments = (src: string): string =>
  src
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");
const serverSource = await import("node:fs").then((fs) =>
  fs.readFileSync(new URL("../src/web/server.ts", import.meta.url), "utf8")
);
check("guards.ts reads no forwarded chain", !/x-forwarded-for/i.test(stripComments(guardsSource)));
check("server.ts reads no forwarded chain", !/x-forwarded-for/i.test(stripComments(serverSource)));
check("server.ts reads the documented X-Real-IP header", /headers\["x-real-ip"\]/.test(serverSource));

console.log("\n=== 15. Internal diagnostic contracts untouched; the public one is separate ===");

// Re-anchored by the observation-boundary pass. This section used to assert
// that the PUBLIC Snapshot still carried primaryConstraint and
// howFixingItWillHelp. It now asserts the approved arrangement instead: the
// internal GrowthSnapshot keeps every field, so the Growth Report keeps its raw
// material, while the public projection carries none of them.
const types = await import("../src/types.js");
const snapshot = await import("../src/contracts/contract5-snapshot.js");
const gated = snapshot.buildUnconfirmedSnapshot();
for (const field of [
  "primaryConstraint",
  "whatIsGoingWell",
  "whyWeThinkThis",
  "howFixingItWillHelp",
  "nextSteps",
  "confidencePlainLanguage",
]) {
  check(
    `internal GrowthSnapshot still carries ${field}`,
    typeof (gated as unknown as Record<string, unknown>)[field] === "string"
  );
}
const projection = await import("../src/projection/public-snapshot.js");
check("public projection builder is exported", typeof projection.buildPublicSnapshot === "function");
check("public boundary note hands judgement to the Report", /That judgement is the Growth Report\./.test(projection.BOUNDARY_NOTE));
check("gated Snapshot still flags verificationRequired", gated.verificationRequired === true);
check("Contract 5 gate helper still exported", typeof snapshot.isConstraintGated === "function");
check("renderRegulatorContext still exported", typeof types.renderRegulatorContext === "function");

// Restore the environment exactly as found.
if (ORIGINAL_BUDGET === undefined) delete process.env.MAX_DAILY_COST_USD;
else process.env.MAX_DAILY_COST_USD = ORIGINAL_BUDGET;
if (ORIGINAL_RATE === undefined) delete process.env.RATE_LIMIT_RUNS_PER_HOUR;
else process.env.RATE_LIMIT_RUNS_PER_HOUR = ORIGINAL_RATE;

console.log(`\n${failed === 0 ? "ALL PASSED" : `${failed} CHECK(S) FAILED`}`);
process.exit(failed === 0 ? 0 : 1);
