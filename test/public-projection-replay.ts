// Historical validation of the public Snapshot projection.
// No network, no LLM calls, no cost. Run: npx tsx test/public-projection-replay.ts [--print]
//
// Projects every preserved run log in runs/ that carries a complete observation
// layer, and checks each result mechanically against the ratified boundary.
// Nothing is fetched, no client evidence is reopened, and no model is called —
// the run logs already on disk are the whole input.
//
// HONEST LIMITATION, stated because it changes how the samples should be read:
// these logs predate the `facts` field on EvidenceEntry, so every count-driven
// observation replays through its fact-free wording. A live run produces the
// more specific sentence ("1 of 7 pages carry a way to get in touch"); the
// replay produces the true but blunter one ("Only some of the pages we read
// carry a way to get in touch"). Both are exercised: this file covers the
// fact-free path against real history, and test/public-snapshot-boundary.ts
// covers the counted path against a fixture.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPublicSnapshot } from "../src/projection/public-snapshot.js";
import type { PublicSnapshot, RunLog } from "../src/types.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RUNS = join(ROOT, "runs");
const PRINT = process.argv.includes("--print");

let failed = 0;
function check(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond || !detail ? "" : `  -> ${detail}`}`);
  if (!cond) failed++;
}

// ─── Load every replayable run ───────────────────────────────────────────────

interface Replay {
  file: string;
  log: RunLog;
  snapshot: PublicSnapshot;
}

const replays: Replay[] = [];
for (const name of readdirSync(RUNS).filter((f) => f.endsWith(".json") && !f.startsWith("spend-")).sort()) {
  let log: RunLog;
  try {
    log = JSON.parse(readFileSync(join(RUNS, name), "utf8")) as RunLog;
  } catch {
    continue; // unreadable file — skipped, never guessed at
  }
  // A replayable run is one that reached the end of the observation layer.
  if (!log.cip || !log.evidencePackage?.entries?.length || !log.input) continue;
  replays.push({
    file: name,
    log,
    snapshot: buildPublicSnapshot({
      input: log.input,
      cip: log.cip,
      evidence: log.evidencePackage,
      pagesFetched: log.pagesFetched ?? [],
      robots: log.robots,
    }),
  });
}

console.log(`=== Replayed ${replays.length} preserved run(s) from runs/ ===\n`);
check("at least three distinct businesses are available to validate against", replays.length >= 3, String(replays.length));

function shingles(text: string, size = 4): string[] {
  const words = text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i + size <= words.length; i++) out.push(words.slice(i, i + size).join(" "));
  return out;
}

function proseOf(s: PublicSnapshot): string {
  return [
    s.businessRead,
    ...s.whatWeCanSee.flatMap((x) => [x.statement, x.proof]),
    ...s.whatIsWorking.flatMap((x) => [x.statement, x.proof]),
    ...s.whatWeCouldNotSettle.flatMap((x) => [x.question, x.reason]),
    s.evidenceConfidence,
    ...s.evidenceReceipt.limitations,
    s.boundaryNote,
  ].join(" ");
}

// ─── Per-run mechanical assessment ───────────────────────────────────────────

// How often each four-word phrase appears across ALL replayed projections. A
// phrase the projection emits for more than one business is its own fixed
// vocabulary — it cannot be evidence that this run's reasoning leaked.
const BOILERPLATE = new Map<string, number>();
for (const { snapshot } of replays) {
  for (const sh of new Set(shingles(proseOf(snapshot)))) {
    BOILERPLATE.set(sh, (BOILERPLATE.get(sh) ?? 0) + 1);
  }
}

const BANNED_CLAIMS: [label: string, pattern: RegExp][] = [
  ["names a constraint", /constraint/i],
  ["ranks or prioritises", /\b(prioritis|prioritiz|ranked|ranking|most important|single biggest|worst|most significant)/i],
  ["claims a consequence of fixing", /\bfixing (this|it|that)\b|\bwill (increase|improve|lead to|result in|mean more)\b/i],
  ["prescribes work", /\byou should\b|\bwe recommend\b|\bstart (by|with)\b/i],
  ["claims findability", /\b(rank well|easy to find|customers can find you|local visibility is)\b/i],
  ["leaks internal vocabulary", /\b(result status|indeterminate|growth function|corpus|run log|static markup|evidence item)\b/i],
  ["leaks an evidence id", /\bE-(VIS|CON|SCA|RES)-\d+/],
  ["publishes a confident zero", /\b0 (pages?|forms?|links?|destinations?|things)\b/i],
];

for (const { file, log, snapshot } of replays) {
  const label = `${log.cip?.businessName ?? file}`;
  const prose = proseOf(snapshot);
  const business = prose.replace(snapshot.boundaryNote, ""); // the note disclaims, see boundary test

  console.log(`--- ${file} ---`);
  for (const [claim, pattern] of BANNED_CLAIMS) {
    const hit = pattern.exec(claim === "names a constraint" ? business : prose);
    check(`${label}: never ${claim}`, hit === null, hit ? `matched "${hit[0]}"` : "");
  }

  // Usefulness, not just safety. A Snapshot that is safe and empty proves
  // nothing to a visitor and would fail the product, so these are checked too.
  const settled = snapshot.evidenceReceipt.signalsSettled;
  check(
    `${label}: states at least one observation where evidence permits`,
    settled === 0 || snapshot.whatWeCanSee.length + snapshot.whatIsWorking.length > 0,
    `${snapshot.whatWeCanSee.length} signals, ${snapshot.whatIsWorking.length} strengths`
  );
  check(
    `${label}: names at least one genuine strength where one concluded`,
    (log.evidencePackage?.entries.filter((e) => e.resultStatus === "Pass").length ?? 0) === 0 ||
      snapshot.whatIsWorking.length > 0
  );
  check(`${label}: is honest about what it could not settle`, snapshot.whatWeCouldNotSettle.length > 0);
  check(
    `${label}: carries an evidence receipt`,
    snapshot.evidenceReceipt.pagesInspectedCount > 0 && snapshot.evidenceReceipt.limitations.length >= 2,
    `${snapshot.evidenceReceipt.pagesInspectedCount} pages, ${snapshot.evidenceReceipt.limitations.length} limitations`
  );
  check(
    `${label}: every stated page was genuinely read`,
    snapshot.evidenceReceipt.pagesInspected.every((u) =>
      (log.pagesFetched ?? []).some((p) => p.url === u && !p.error && p.status < 400)
    )
  );
  check(
    `${label}: business read names the business, not a verdict`,
    snapshot.businessRead.startsWith("Your public pages present the business as")
  );
  check(
    `${label}: confidence is about the evidence`,
    /we settled \d+ of the \d+ things we looked at/i.test(snapshot.evidenceConfidence)
  );

  // The internal hypothesis for this same run must NOT appear in the projection.
  //
  // Tested on four-word phrases, not on single words. Both texts describe the
  // same website in English, so "business", "homepage" and "evidence" appear in
  // both by necessity and prove nothing; a shared four-word sequence does not
  // happen by coincidence and is the shape an actual leak would take.
  const internal = [
    log.reasoningResult?.primaryConstraint ?? "",
    ...(log.reasoningResult?.secondaryConstraints ?? []),
    log.growthSnapshot?.primaryConstraint ?? "",
    log.growthSnapshot?.howFixingItWillHelp ?? "",
  ].join(" ");
  if (internal.trim()) {
    const publicShingles = new Set(shingles(prose));
    const name = (log.cip?.businessName ?? "").toLowerCase();
    const leaked = [...new Set(shingles(internal))].filter(
      (sh) =>
        publicShingles.has(sh) &&
        // Not the projection's own fixed vocabulary. A phrase this projection
        // emits for every business ("we have no way to", "google business
        // profile map") collides with any internal text about the same website
        // and proves nothing; a phrase unique to THIS run is the real signal.
        (BOILERPLATE.get(sh) ?? 0) < 2 &&
        // Not the business's own name, which the public read states on purpose.
        !name.includes(sh)
    );
    check(
      `${label}: no phrase unique to the internal constraint reached the public copy`,
      leaked.length === 0,
      leaked.slice(0, 3).join(" | ")
    );
  }
  console.log("");
}

// ─── Sample output for Product Council ───────────────────────────────────────

if (PRINT) {
  for (const { file, snapshot } of replays) {
    console.log(`\n############ ${file} ############`);
    console.log(snapshot.businessRead);
    console.log(`\nWHAT WE CAN SEE`);
    for (const x of snapshot.whatWeCanSee) console.log(`  · ${x.statement}\n      ${x.proof}`);
    console.log(`\nWHAT IS WORKING`);
    for (const x of snapshot.whatIsWorking) console.log(`  · ${x.statement}\n      ${x.proof}`);
    console.log(`\nWHAT WE COULD NOT SETTLE`);
    for (const x of snapshot.whatWeCouldNotSettle) console.log(`  · ${x.question}\n      ${x.reason}`);
    console.log(`\nCONFIDENCE\n  ${snapshot.evidenceConfidence}`);
    console.log(`\nEVIDENCE RECEIPT`);
    console.log(
      `  ${snapshot.evidenceReceipt.pagesInspectedCount} page(s) read; ` +
        `${snapshot.evidenceReceipt.signalsSettled} of ${snapshot.evidenceReceipt.signalsChecked} settled.`
    );
    for (const u of snapshot.evidenceReceipt.pagesInspected) console.log(`  - ${u}`);
    for (const l of snapshot.evidenceReceipt.limitations) console.log(`  ! ${l}`);
    console.log(`\n${snapshot.boundaryNote}`);
  }
}

console.log(`\n${failed === 0 ? "ALL PASSED" : `${failed} CHECK(S) FAILED`}`);
process.exit(failed === 0 ? 0 : 1);
