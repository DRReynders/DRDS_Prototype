// Bounded Patch Area C1 — healthcare/dental classification plumbing tests.
// No network, no LLM calls, no cost. Run: npx tsx test/areac1-sector.ts
//
// Root cause being fixed: the CIP taxonomy offered only Financial Advisory, Legal,
// Accounting, Consulting, Other Professional Service and Other. A dental practice
// had no correct option, so Run 001 labelled iSmile "Other Professional Service"
// and never applied any sector caution to its recommendations.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { REGULATOR_SENSITIVE_AREAS, deriveSectorFields } from "../src/contracts/contract1-cip.js";
import type { ClientIdentificationPacket } from "../src/types.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

let failed = 0;
function check(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond || !detail ? "" : `  -> ${detail}`}`);
  if (!cond) failed++;
}

console.log("=== 1-2. Dental maps to Healthcare and is regulator-sensitive ===");
const dental = deriveSectorFields("Dental");
check("sector is Healthcare", dental.sector === "Healthcare", dental.sector);
check("regulatorSensitive is true", dental.regulatorSensitive === true);
check("areas populated", (dental.regulatorSensitiveAreas?.length ?? 0) === 8, String(dental.regulatorSensitiveAreas?.length));

console.log("\n=== 3. Healthcare / Medical is regulator-sensitive ===");
const medical = deriveSectorFields("Healthcare / Medical");
check("sector is Healthcare", medical.sector === "Healthcare", medical.sector);
check("regulatorSensitive is true", medical.regulatorSensitive === true);

console.log("\n=== 3b. Near-miss labels a model might emit still resolve ===");
for (const t of ["Dentist", "Dentistry", "Orthodontic Practice", "Medical Practice", "Healthcare", "Health Care", "Dental Clinic"]) {
  check(`"${t}" resolves to Healthcare`, deriveSectorFields(t).sector === "Healthcare", deriveSectorFields(t).sector);
}

console.log("\n=== 4. Non-healthcare types stay General and unflagged ===");
for (const t of ["Financial Advisory", "Legal", "Accounting", "Consulting", "Other Professional Service", "Other"]) {
  const d = deriveSectorFields(t);
  check(`"${t}" sector is General`, d.sector === "General", d.sector);
  check(`"${t}" regulatorSensitive is false`, d.regulatorSensitive === false);
  check(`"${t}" carries no areas array`, d.regulatorSensitiveAreas === undefined);
}
check("empty businessType does not throw and stays General", deriveSectorFields("").sector === "General");

console.log("\n=== 5. regulatorSensitiveAreas content ===");
for (const area of [
  "patient testimonials",
  "reviews and review-generation",
  "before/after imagery",
  "case studies",
  "treatment outcomes",
  "comparative/superlative claims",
  "success-rate claims",
  "credential and professional-registration display",
]) {
  check(`area present: ${area}`, dental.regulatorSensitiveAreas?.includes(area) === true);
}
check("caller gets a copy, not the shared constant", dental.regulatorSensitiveAreas !== REGULATOR_SENSITIVE_AREAS);
dental.regulatorSensitiveAreas?.push("mutation attempt");
check("mutating the copy leaves the constant intact", REGULATOR_SENSITIVE_AREAS.length === 8, String(REGULATOR_SENSITIVE_AREAS.length));

console.log("\n=== 6. Backwards compatibility ===");
// A CIP shaped exactly as Run 001 produced it, with none of the new fields.
const legacy: ClientIdentificationPacket = {
  businessName: "iSmile Dental Salt River",
  businessType: "Other Professional Service",
  primaryDigitalAsset: "ismiledentalct.com",
  detectedDigitalAssets: [],
  location: "340 Victoria Road, Salt River, Cape Town",
  observedLanguages: ["English"],
  identificationConfidence: "Medium-High",
  identityConflicts: [],
  notes: "unchanged",
};
check("legacy CIP is still a valid ClientIdentificationPacket", legacy.businessName.length > 0);
check("sector absent on a legacy CIP", legacy.sector === undefined);
check("regulatorSensitive absent on a legacy CIP", legacy.regulatorSensitive === undefined);
const upgraded: ClientIdentificationPacket = { ...legacy, ...deriveSectorFields("Dental") };
check("existing fields survive the spread", upgraded.businessName === legacy.businessName && upgraded.notes === "unchanged");
check("upgraded CIP is flagged", upgraded.regulatorSensitive === true);

console.log("\n=== 7. Determinism, and no extra LLM call ===");
check("same input yields same output", JSON.stringify(deriveSectorFields("Dental")) === JSON.stringify(deriveSectorFields("Dental")));
const cipSource = readFileSync(join(ROOT, "src/contracts/contract1-cip.ts"), "utf8");
// The call site is `llmJson<CipLlmResponse>(...)`, so match the name plus either
// a generic parameter or an open paren.
const llmCalls = (cipSource.match(/\bllmJson\s*[<(]/g) ?? []).length;
check("exactly one llmJson call remains in Contract 1", llmCalls === 1, String(llmCalls));
check("derivation is pure code, not a prompt", !/loadPrompt\(\s*["']sector/i.test(cipSource));

console.log("\n=== 8. Taxonomy actually reaches the prompt ===");
const prompt = readFileSync(join(ROOT, "prompts/cip-identification.txt"), "utf8");
check("Dental offered in the instruction list", /taxonomy:[\s\S]{0,200}Dental/.test(prompt));
check("Healthcare / Medical offered in the instruction list", prompt.includes("Healthcare / Medical"));
check("Dental present in the JSON schema line", /"businessType":[^\n]*"Dental"/.test(prompt));
check("Healthcare / Medical present in the JSON schema line", /"businessType":[^\n]*"Healthcare \/ Medical"/.test(prompt));
check("original taxonomy options retained", ["Financial Advisory", "Legal", "Accounting", "Consulting", "Other Professional Service"].every((t) => prompt.includes(t)));

console.log("\n=== 9. Report-safety framing, not legal advice ===");
const typesSource = readFileSync(join(ROOT, "src/types.ts"), "utf8");
check("type is documented as a report-safety flag", /REPORT-SAFETY FLAG ONLY/.test(typesSource));
check("explicitly disclaims legal advice", /not legal advice/i.test(typesSource) && /not legal advice/i.test(cipSource));

console.log(`\n${failed === 0 ? "ALL PASSED" : `${failed} CHECK(S) FAILED`}`);
process.exit(failed === 0 ? 0 : 1);
