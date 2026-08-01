// Patch 001.4 — local-market visibility blind-spot acknowledgement tests.
// No network, no LLM calls, no cost. Run: npx tsx test/patch0014-blindspot.ts
//
// The regression: Run 002 recorded "GBP non-assessment is a material blind spot
// given this is a local-lead-gen goal; flagged rather than ignored." Run 003 reached
// a better diagnosis and lost that sentence entirely — zero mentions of GBP, Google
// Business Profile, local pack or local search anywhere in the reasoning result,
// while all three GBP evidence items still sat at Not Assessed.
//
// Losing the acknowledgement is worse than losing an item. An unmeasured area that
// nobody names reads, to anyone downstream, like an area with nothing wrong in it.
//
// This patch does NOT measure GBP. It requires the reasoning layer to say out loud
// that it did not.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const cder = readFileSync(join(ROOT, "prompts/cder-reasoning.txt"), "utf8");
const flat = cder.replace(/\s+/g, " ");
const section = cder.split("Local-market visibility blind spot")[1]?.split("Regulator-sensitive sectors")[0] ?? "";
const sectionFlat = section.replace(/\s+/g, " ");

let failed = 0;
function check(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond || !detail ? "" : `  -> ${detail}`}`);
  if (!cond) failed++;
}

console.log("=== 1. The blind spot must be acknowledged for local businesses ===");
check("section exists", section.length > 200, String(section.length));
check("states the run has no method for these surfaces", /has no method for Google Business Profile/.test(sectionFlat));
for (const surface of ["map or local-pack presence", "local rankings", "impressions", "traffic"]) {
  check(`names the unmeasured surface: ${surface}`, sectionFlat.includes(surface));
}
check("explains why they read Not Assessed", /come\s*back Not Assessed/.test(sectionFlat) || /come back Not Assessed/.test(sectionFlat));

console.log("\n=== 2. Local-business trigger is described concretely ===");
for (const signal of [
  "one trading location",
  "published address and opening",
  "appointments or bookings",
  "clinic, practice, salon, workshop or studio",
  "catchment named in its own copy",
]) {
  check(`trigger signal present: ${signal}`, sectionFlat.includes(signal));
}
check("conditioned on no usable local-search evidence", /no usable local-search or GBP evidence exists/.test(sectionFlat));

console.log("\n=== 3. Where the acknowledgement must land ===");
check("reasoningNotes named", /reasoningNotes/.test(section));
check("secondaryConstraints named", /secondaryConstraints/.test(section));
check("scoped as a rival to the chosen constraint", /plausible rival to the constraint you chose/.test(sectionFlat));
check("kept short", /One or two sentences, not a paragraph/.test(sectionFlat));

console.log("\n=== 4. Inventing local visibility is forbidden in both directions ===");
check("forbids strong/weak/sufficient/poor", /Never state or imply that local visibility is strong, weak, sufficient or poor/.test(sectionFlat));
check("names the no-evidence-either-way reason", /no evidence in either direction/.test(sectionFlat));
check("calls out a guess dressed as a limitation", /a guess dressed as a limitation is still a\s*guess/.test(sectionFlat) || /guess dressed as a limitation is still a guess/.test(sectionFlat));
check("forbids inventing figures", /Never invent a ranking, a review count, a map position or a comparison to competitors/.test(sectionFlat));

console.log("\n=== 5. On-page discoverability is not local-market visibility ===");
check("states the distinction", /Never infer local-market visibility from on-page discoverability/.test(sectionFlat));
check("names the on-page signals", /Titles, headings,\s*meta descriptions and a complete page set/.test(sectionFlat) || /Titles, headings, meta descriptions and a complete page set/.test(sectionFlat));
check("describes the site vs its standing", /describe the site, not its standing in a\s*local market/.test(sectionFlat) || /not its standing in a local market/.test(sectionFlat));
check("gives the both-ways illustration", /built well and be invisible/.test(sectionFlat) && /first result on reputation alone/.test(sectionFlat));

console.log("\n=== 6. Confidence limitation when the constraint IS visibility ===");
check("names the visibility-constraint case", /If your Primary Constraint is itself about visibility or discoverability for a local\s*business/.test(sectionFlat) || /Primary Constraint is itself about visibility or discoverability/.test(sectionFlat));
check("caps confidence at Medium or below", /keep confidence at Medium or below/.test(sectionFlat));
check("requires it in the constraint text", /say\s*in the constraint text that local-market visibility was not examined/.test(sectionFlat) || /constraint text that local-market visibility was not examined/.test(sectionFlat));

console.log("\n=== 7. A non-visibility primary constraint stays legitimate ===");
check("names the other-constraint case", /capture, conversion,\s*credibility, response/.test(sectionFlat) || /capture, conversion, credibility, response/.test(sectionFlat));
check("permits naming and standing behind it", /name it and stand behind it/.test(sectionFlat));
check("gap does not weaken a well-evidenced constraint", /does not weaken a\s*constraint that is well evidenced elsewhere/.test(sectionFlat) || /does not weaken a constraint that is well evidenced elsewhere/.test(sectionFlat));
check("recorded as unmeasured rival, not a hedge", /unmeasured rival,\s*not as a reason to hedge/.test(sectionFlat) || /unmeasured rival, not as a reason to hedge/.test(sectionFlat));

console.log("\n=== 8. No bloat, no client-facing legalese ===");
check("framed as internal reasoning honesty", /internal reasoning honesty, not a client disclaimer/.test(sectionFlat));
check("protects Snapshot and report length", /the Snapshot and the\s*report stay short/.test(sectionFlat) || /Snapshot and the report stay short/.test(sectionFlat));
check("forbids a caveat paragraph for the reader", /nothing here becomes a caveat paragraph for the reader/.test(sectionFlat));
check("section is concise", section.split(/\s+/).filter(Boolean).length < 330, String(section.split(/\s+/).filter(Boolean).length));

console.log("\n=== 9. This is not GBP integration ===");
check("no API or fetch instruction", !/api|endpoint|places|scrape|http/i.test(sectionFlat));
check("no promise that GBP will be measured", !/we will measure|once we have GBP|after fetching/i.test(sectionFlat));
check("GBP items still honestly Not Assessed in code", /Absence of confirmation is not confirmed absence/.test(readFileSync(join(ROOT, "src/evidence/checks.ts"), "utf8")));

console.log("\n=== 10. Earlier prompt guards intact ===");
check("A2 coverage rule intact", /A growth function showing 0 usable items/.test(cder));
check("001.2 usable/attempted wording intact", /produced a USABLE result over items ATTEMPTED/.test(cder));
check("C2 regulator section intact", /Regulator-sensitive sectors/.test(cder));
check("C2 legal-advice disclaimer intact", /Nothing you write here is legal advice/.test(cder));
check("placeholders intact", cder.includes("{{GOAL_MODEL}}") && cder.includes("{{EVIDENCE_PACKAGE}}") && cder.includes("{{REGULATOR_CONTEXT}}"));
check("honesty rules on evidence lists intact", /may not cite entries whose Result Status is\s*Indeterminate or Requires Browser Confirmation/.test(flat));
check("output format unchanged", /"hypothesisConfidence": "High" \| "Medium" \| "Low"/.test(cder));

console.log("\n=== 11. Patch 001.3 Snapshot guard untouched ===");
const snapPrompt = readFileSync(join(ROOT, "prompts/snapshot-copywriting.txt"), "utf8").replace(/\s+/g, " ");
check("evidence boundary section intact", /Evidence boundary/.test(snapPrompt));
check("'easy to find online' still blocked", /Easy to find online/.test(snapPrompt));
check("on-page vs findability distinction intact", /On-page signals are not findability/.test(snapPrompt));
check("unassessed-not-a-strength rule intact", /never as a strength/.test(snapPrompt));

console.log("\n=== 12. Guard is general, not iSmile-specific ===");
check("no client name", !/ismile/i.test(cder));
check("no single-sector assumption in the section", !/dental|dentist/i.test(sectionFlat));

console.log(`\n${failed === 0 ? "ALL PASSED" : `${failed} CHECK(S) FAILED`}`);
process.exit(failed === 0 ? 0 : 1);
