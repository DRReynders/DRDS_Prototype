// Phase 1 replay — do the two historical false constraints still survive?
// No network, no LLM calls, no cost. Run: npx tsx test/phase1-replay.ts
//
// HONEST LIMITATION: the preserved run logs predate P1-a, so they contain no
// dynamicSignals. This replay therefore supplies the signals that the rendered
// integrity passes independently PROVED were present on those exact pages
// (15 Elementor counters on Lyle's site; a lazy gallery on the Booksy profile),
// then runs the real patched code over the real recorded evidence. It verifies
// the guard logic against genuine data — it does not re-verify the fetch layer,
// which fixture tests in phase1-safety.ts cover instead.

import { readFileSync } from "node:fs";
import { applyZeroAbsentSafetyRule, corpusDynamicSignals } from "../src/evidence/checks.js";
import type { SiteCorpus } from "../src/site.js";
import { EMPTY_DYNAMIC_SIGNALS, type EvidenceEntry, type FetchedPage, type RunLog } from "../src/types.js";

const CLIENTS = "C:/Users/David/Documents/DRDS/Clients";
const LYLE = `${CLIENTS}/Lyle_van_Tonder/02_Evidence/01_Public/2026-07-29_LyleVanTonder_RunLog.json`;
const BOOKSY = `${CLIENTS}/Van Niekerk's Barber/03 Evidence/01 Public/2026-07-29_Booksy_RunLog_VanNiekerksBarber.json`;

let failed = 0;
function check(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond || !detail ? "" : `  -> ${detail}`}`);
  if (!cond) failed++;
}

function page(url: string, signals: Partial<typeof EMPTY_DYNAMIC_SIGNALS>): FetchedPage {
  return {
    url, finalUrl: url, status: 200, html: "", text: "", title: "", metaDescription: "",
    h1s: [], links: [], canonical: "", images: [], fetchedAt: new Date().toISOString(),
    dynamicSignals: { ...EMPTY_DYNAMIC_SIGNALS, ...signals },
  };
}

function corpusWith(url: string, signals: Partial<typeof EMPTY_DYNAMIC_SIGNALS>): SiteCorpus {
  return { homepage: page(url, signals), internalPages: [], robotsDisallows: [], robotsBlockedUrls: [], unfetchedCandidates: [] };
}

// The real P1-d gate, extracted here exactly as contract4-reasoning.ts applies it.
function applyConstraintGate(entries: EvidenceEntry[], supportingIds: string[]) {
  const byId = new Map(entries.map((e) => [e.evidenceId, e]));
  const isReportSafe = (id: string) => {
    const s = byId.get(id)?.resultStatus;
    return s !== undefined && s !== "Not Assessed" && s !== "Not Applicable" && s !== "Indeterminate";
  };
  const kept = supportingIds.filter(isReportSafe);
  const dropped = supportingIds.filter((id) => !isReportSafe(id));
  // Mirrors contract4-reasoning.ts: gate when the constraint rests MAINLY on
  // withdrawn evidence, not only when every item is withdrawn.
  return { kept, dropped, gated: supportingIds.length > 0 && dropped.length > kept.length };
}

function loadRun(path: string): RunLog {
  return JSON.parse(readFileSync(path, "utf8")) as RunLog;
}

// ---------------------------------------------------------------------------
console.log("=== REPLAY 1: Lyle van Tonder — 'every metric displays as zero' ===");
{
  const log = loadRun(LYLE);
  const entries = log.evidencePackage!.entries;
  const supportingIds = log.reasoningResult!.supportingEvidence.map((r) => r.evidenceId);
  console.log(`  recorded constraint : ${log.reasoningResult!.primaryConstraint.slice(0, 96)}…`);
  console.log(`  recorded confidence : ${log.reasoningResult!.hypothesisConfidence}`);
  console.log(`  recorded support    : ${supportingIds.join(", ")}`);

  const before = applyConstraintGate(entries, supportingIds);
  check("BEFORE patch: constraint was supported (this is the bug)", !before.gated && before.kept.length > 0);

  // Rendered pass proved 15 Elementor counters across three pages.
  const signals = corpusDynamicSignals(corpusWith("https://lylevantonder.com/", { counters: 15, lazyImages: 21 }));
  const patched = entries.map((e) => applyZeroAbsentSafetyRule(e, signals));

  const econ018 = patched.find((e) => e.evidenceId === "E-CON-018")!;
  const esc001 = patched.find((e) => e.evidenceId === "ESC-001");
  check("E-CON-018 becomes Indeterminate", econ018.resultStatus === "Indeterminate", econ018.resultStatus);
  if (esc001) check("ESC-001 becomes Indeterminate", esc001.resultStatus === "Indeterminate", esc001.resultStatus);

  const after = applyConstraintGate(patched, supportingIds);
  console.log(`  after patch — kept: [${after.kept.join(", ")}]  dropped: [${after.dropped.join(", ")}]`);
  check("AFTER patch: zero-metric support withdrawn", after.dropped.includes("E-CON-018") && after.dropped.includes("ESC-001"));
  check("AFTER patch: constraint gated (confidence forced Low, rendered verification required)", after.gated,
    `kept ${after.kept.length}: ${after.kept.join(", ")}`);
}

// ---------------------------------------------------------------------------
console.log("\n=== REPLAY 2: Van Niekerk's Barber — 'no visual proof' ===");
{
  const log = loadRun(BOOKSY);
  const entries = log.evidencePackage!.entries;
  const supportingIds = log.reasoningResult!.supportingEvidence.map((r) => r.evidenceId);
  console.log(`  recorded constraint : ${log.reasoningResult!.primaryConstraint.slice(0, 96)}…`);
  console.log(`  recorded support    : ${supportingIds.join(", ")}`);
  console.log(`  escalation fetched  : ${log.escalationTrace?.urlFetched}`);

  // Rendered pass proved a hero gallery ("Show all photos / +6") on the profile.
  const signals = corpusDynamicSignals(
    corpusWith("https://booksy.com/en-za/32677_van-niekerk-s-barber-shop_barbers_58419_kaapstad", {
      lazyImages: 10, galleries: 2, carousels: 1,
    })
  );
  const patched = entries.map((e) => applyZeroAbsentSafetyRule(e, signals));

  const econ018 = patched.find((e) => e.evidenceId === "E-CON-018")!;
  check("E-CON-018 ('no before/after proof') becomes Indeterminate", econ018.resultStatus === "Indeterminate", econ018.resultStatus);

  const after = applyConstraintGate(patched, supportingIds);
  console.log(`  after patch — kept: [${after.kept.join(", ")}]  dropped: [${after.dropped.join(", ")}]`);
  check("AFTER patch: visual-proof support withdrawn", after.dropped.includes("E-CON-018"));
  check("AFTER patch: constraint gated", after.gated, `kept ${after.kept.length}`);

  // The escalation guard is the second, independent protection for this run.
  const { isSiblingTenantUrl } = await import("../src/site.js");
  check(
    "escalation guard would have rejected the competitor URL that was actually fetched",
    isSiblingTenantUrl(
      "https://booksy.com/en-za/32677_van-niekerk-s-barber-shop_barbers_58419_kaapstad",
      log.escalationTrace!.urlFetched!
    )
  );
}

console.log(`\n${failed === 0 ? "ALL PASSED" : `${failed} CHECK(S) FAILED`}`);
process.exit(failed === 0 ? 0 : 1);
