// Bounded Patch Area C2 — regulator-sensitive routing and wording guard tests.
// No network, no LLM calls, no cost. Run: npx tsx test/areac2-regulator.ts
//
// C1 set the flag on the CIP. C2 routes it to the two stages that write words a
// client reads, and to report assembly. Run 001 recommended toward patient
// testimonials, before/after imagery and outcome proof for a dental practice with
// no awareness those are restricted categories — this is the guard against that.
//
// The flag is deliberately NOT copied onto GoalModel or ReasoningResult: one
// source of truth means one place it can be wrong.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildUnconfirmedSnapshot, isConstraintGated } from "../src/contracts/contract5-snapshot.js";
import { deriveSectorFields } from "../src/contracts/contract1-cip.js";
import { renderRegulatorContext } from "../src/types.js";
import type { ClientIdentificationPacket, ReasoningResult, RunLog } from "../src/types.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

let failed = 0;
function check(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond || !detail ? "" : `  -> ${detail}`}`);
  if (!cond) failed++;
}

function cipOf(businessType: string): ClientIdentificationPacket {
  return {
    businessName: "Test Practice",
    businessType,
    primaryDigitalAsset: "example.co.za",
    detectedDigitalAssets: [],
    location: "Cape Town",
    observedLanguages: ["English"],
    identificationConfidence: "Medium-High",
    identityConflicts: [],
    notes: "n",
    ...deriveSectorFields(businessType),
  };
}

const dental = cipOf("Dental");
const general = cipOf("Consulting");

console.log("=== 1. Healthcare/Dental context reaches the rendered prompt input ===");
const dentalCtx = renderRegulatorContext(dental);
check("marked regulator-sensitive", /REGULATOR-SENSITIVE/.test(dentalCtx), dentalCtx);
check("sector named", dentalCtx.includes("Healthcare"), dentalCtx);
check("business type named", dentalCtx.includes("Dental"));
check("areas enumerated", dentalCtx.includes("patient testimonials") && dentalCtx.includes("before/after imagery"));
check("routes to review", /professional, legal or client review/.test(dentalCtx));

console.log("\n=== 2. General business does not trigger regulator-sensitive wording ===");
const generalCtx = renderRegulatorContext(general);
check("states General explicitly", /Sector: General/.test(generalCtx), generalCtx);
check("no sensitivity marker", !/REGULATOR-SENSITIVE/.test(generalCtx));
check("no areas listed", !generalCtx.includes("patient testimonials"));
check("undefined CIP is treated as General", /Sector: General/.test(renderRegulatorContext(undefined)));

console.log("\n=== 3. Both prompts consume the context ===");
const cder = readFileSync(join(ROOT, "prompts/cder-reasoning.txt"), "utf8");
const snapPrompt = readFileSync(join(ROOT, "prompts/snapshot-copywriting.txt"), "utf8");
check("cder prompt has the placeholder", cder.includes("{{REGULATOR_CONTEXT}}"));
check("snapshot prompt has the placeholder", snapPrompt.includes("{{REGULATOR_CONTEXT}}"));
check("cder guard is conditional on the context", /If the Regulator-Sensitive Context above/.test(cder));
check("snapshot guard is conditional on the context", /If the Regulator-Sensitive Context above/.test(snapPrompt));
check("cder guard names the restricted categories", /before\/after imagery/.test(cder) && /success-rate claims/.test(cder));
check("cder forbids casual recommendation", /Do not recommend adding any of them casually/.test(cder));
check("cder forbids treating absence as a plain weakness", /deliberate compliance choice/.test(cder));
check("cder disclaims legal advice", /Nothing you write here is legal advice/.test(cder));
check("cder keeps the diagnosis intact", /never the diagnosis/.test(cder));
check("snapshot guard protects word caps", /every word cap above still applies/.test(snapPrompt));
check("snapshot guard forbids added disclaimers", /must not add a\s*\n?\s*disclaimer/.test(snapPrompt) || /not add a disclaimer/.test(snapPrompt.replace(/\s+/g, " ")));
check("snapshot guard has a General escape", /says General, ignore this paragraph/.test(snapPrompt));

console.log("\n=== 4. Contracts accept the CIP and the gated path is unchanged ===");
const c4 = readFileSync(join(ROOT, "src/contracts/contract4-reasoning.ts"), "utf8");
const c5 = readFileSync(join(ROOT, "src/contracts/contract5-snapshot.ts"), "utf8");
check("Contract 4 takes an optional cip param", /cip\?: ClientIdentificationPacket/.test(c4));
check("Contract 4 renders the context", /REGULATOR_CONTEXT: renderRegulatorContext\(cip\)/.test(c4));
check("Contract 4 passes cip through the escalation re-reason", /reason\(gm, finalPkg, cip\)/.test(c4));
check("Contract 5 takes an optional cip param", /cip\?: ClientIdentificationPacket/.test(c5));
check("Contract 5 renders the context", /REGULATOR_CONTEXT: renderRegulatorContext\(cip\)/.test(c5));

const gated: ReasoningResult = {
  businessGoal: "g",
  expectedGrowthFunctions: [],
  primaryConstraint: "c",
  hypothesisConfidence: "Low",
  evidenceCoverage: "Partial",
  supportingEvidence: [],
  contradictoryEvidence: [],
  secondaryConstraints: [],
  reasoningNotes: "",
  constraintSafety: { status: "requires-rendered-verification", reason: "r", droppedSupportingEvidence: [] },
};
check("gate still detected", isConstraintGated(gated));
const fixed = buildUnconfirmedSnapshot();
check("gated copy still fixed and model-free", fixed.verificationRequired === true);
check("gated copy unchanged by C2", fixed.primaryConstraint.startsWith("We reviewed your public pages"));
check("gated copy names no constraint", !/constraint/i.test(Object.values(fixed).filter((v) => typeof v === "string").join(" ")));
check("gated path returns before any prompt render", /if \(isConstraintGated\(rr\)\) return buildUnconfirmedSnapshot\(\);/.test(c5));

console.log("\n=== 5-7. Report assembly gate ===");
const { assemble: assembleReport } = await import("../tools/assemble-report.js");
function logWith(cip: ClientIdentificationPacket | undefined): RunLog {
  return {
    runId: "test-run",
    startedAt: new Date().toISOString(),
    input: { inputType: "Website URL", rawInputValue: "x", normalisedBusinessIdentifier: "x", normalisationStatus: "Success", normalisationNotes: "" },
    pagesFetched: [],
    stages: [],
    cip,
    goalModel: { businessGoal: "g", expectedGrowthFunctions: ["Capture"], goalModelConfidence: "Medium", reasoningBasis: "b" },
    evidencePackage: { entries: [], evidenceCoverage: "Partial" },
    reasoningResult: {
      businessGoal: "g", expectedGrowthFunctions: ["Capture"], primaryConstraint: "c",
      hypothesisConfidence: "Medium", evidenceCoverage: "Partial", supportingEvidence: [],
      contradictoryEvidence: [], secondaryConstraints: [], reasoningNotes: "",
    },
  } as RunLog;
}

const dentalReport = assembleReport(logWith(dental), "test.json");
check("safety note present for regulator-sensitive CIP", /REGULATOR-SENSITIVE SECTOR/.test(dentalReport));
check("note names the business type", /REGULATOR-SENSITIVE SECTOR \(Dental\)/.test(dentalReport));
check("note routes to review", /professional, legal or client review/.test(dentalReport));
check("note warns against calling absence a weakness", /deliberate compliance choice/.test(dentalReport));
check("note disclaims legal advice", /not legal advice/.test(dentalReport));
check("note is short — a gate, not a section", (dentalReport.match(/REGULATOR-SENSITIVE SECTOR/g) ?? []).length === 1);
check("no new report heading was introduced", !/^## .*[Rr]egulator/m.test(dentalReport));

const generalReport = assembleReport(logWith(general), "test.json");
check("note omitted for a General business", !/REGULATOR-SENSITIVE SECTOR/.test(generalReport));

const legacyCip = { ...cipOf("Other Professional Service") };
delete (legacyCip as Partial<ClientIdentificationPacket>).sector;
delete (legacyCip as Partial<ClientIdentificationPacket>).regulatorSensitive;
delete (legacyCip as Partial<ClientIdentificationPacket>).regulatorSensitiveAreas;
const legacyReport = assembleReport(logWith(legacyCip), "test.json");
check("legacy run log with no flag still assembles", legacyReport.length > 500);
check("legacy run log gets no safety note", !/REGULATOR-SENSITIVE SECTOR/.test(legacyReport));
check("legacy CIP renders as General", /Sector: General/.test(renderRegulatorContext(legacyCip)));

console.log("\n=== 8. No extra LLM call, and the flag is not duplicated ===");
check("Contract 4 still makes one reasoning call per reason()", (c4.match(/llmJson</g) ?? []).length === 2, String((c4.match(/llmJson</g) ?? []).length));
check("Contract 5 still makes exactly one call", (c5.match(/llmJson</g) ?? []).length === 1);
const types = readFileSync(join(ROOT, "src/types.ts"), "utf8");
const gmBlock = types.slice(types.indexOf("export interface GoalModel"), types.indexOf("// Contract 3 — Evidence"));
check("GoalModel does not carry the flag", !/regulatorSensitive/.test(gmBlock), gmBlock.slice(0, 200));
const rrBlock = types.slice(types.indexOf("export interface ReasoningResult"), types.indexOf("// Contract 5 — Growth Snapshot"));
check("ReasoningResult does not carry the flag", !/regulatorSensitive/.test(rrBlock));

console.log("\n=== 9. pipeline.ts change is narrow ===");
const pipe = readFileSync(join(ROOT, "src/pipeline.ts"), "utf8");
check("Contract 4 call passes the cip", /runContract4\(log\.goalModel!, log\.evidencePackage!, corpus, log\.cip\)/.test(pipe));
check("Contract 5 call passes the cip", /runContract5\(log\.reasoningResult!, log\.cip\)/.test(pipe));
check("stage order unchanged", pipe.indexOf("runContract4") < pipe.indexOf("runContract5"));
check("no new contract stages added", (pipe.match(/runContract\d/g) ?? []).length === 12, String((pipe.match(/runContract\d/g) ?? []).length));

console.log(`\n${failed === 0 ? "ALL PASSED" : `${failed} CHECK(S) FAILED`}`);
process.exit(failed === 0 ? 0 : 1);
