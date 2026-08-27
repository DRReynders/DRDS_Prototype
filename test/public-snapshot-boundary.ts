// The public observation boundary, tested end to end and entirely offline.
// No network, no LLM calls, no cost. Run: npx tsx test/public-snapshot-boundary.ts
//
// Product Council boundary, ratified:
//
//   The Growth Snapshot may state what is observably true.
//   Only the Growth Report may state what matters most.
//
// Wording alone never held that line — the free product named and ranked a
// constraint for months while the site copy said it did not. So these checks
// are about SHAPE and REACHABILITY, not about copy: they assert that judgement
// is absent from the public type, unreachable from the projection's inputs,
// missing from the wire payload, and unrenderable by either frontend.
//
// Sections map 1:1 onto the boundaries Product Council asked to be proven.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildUnconfirmedSnapshot } from "../src/contracts/contract5-snapshot.js";
import { renderSnapshotEmailHtml } from "../src/email.js";
import { buildPublicSnapshot, BOUNDARY_NOTE, EMPTY_STATE } from "../src/projection/public-snapshot.js";
import type {
  BusinessInput,
  ClientIdentificationPacket,
  EvidenceEntry,
  EvidencePackage,
  PublicSnapshot,
  ResultStatus,
} from "../src/types.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string): string => readFileSync(join(ROOT, rel), "utf8");

let failed = 0;
function check(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond || !detail ? "" : `  -> ${detail}`}`);
  if (!cond) failed++;
}

// ─── Fixture ─────────────────────────────────────────────────────────────────
//
// Shaped on the real 2026-08-17 Maystone run: a mix of Pass, Partial, Fail,
// Indeterminate, Requires Browser Confirmation and Not Assessed, spread across
// several growth functions. No client name and no client URL appears.

function evidence(
  evidenceId: string,
  growthFunction: string,
  resultStatus: ResultStatus,
  facts?: Record<string, number>
): EvidenceEntry {
  return {
    evidenceId,
    growthFunction,
    evidenceType: "Observation",
    evidenceValue: `internal wording for ${evidenceId} — Result Status ${resultStatus}, usable coverage note`,
    resultStatus,
    source: "https://example.test/",
    evidenceAccessibility: "Publicly Observable",
    observation: "internal observation prose; static markup, corpus, pipeline vocabulary lives here",
    ...(facts ? { facts } : {}),
  };
}

const ENTRIES: EvidenceEntry[] = [
  evidence("E-VIS-001", "Discoverability", "Pass", { pages: 7, missing: 0, duplicated: 0 }),
  evidence("E-VIS-002", "Discoverability", "Partial", { pages: 7, missing: 2, duplicated: 1 }),
  evidence("E-VIS-003", "Discoverability", "Pass", { pages: 7, bad: 0 }),
  evidence("E-VIS-016", "Credibility", "Pass", { https: 1 }),
  evidence("E-VIS-041", "Discoverability", "Partial", { found: 3, wanted: 5 }),
  evidence("E-VIS-004", "Discoverability / Credibility", "Pass"),
  evidence("E-VIS-027", "Credibility", "Requires Browser Confirmation"),
  evidence("E-CON-017", "Credibility", "Requires Browser Confirmation"),
  evidence("E-CON-018", "Credibility / Persuasion", "Indeterminate"),
  evidence("E-VIS-018", "Discoverability", "Not Assessed"),
  evidence("E-VIS-037", "Discoverability", "Not Assessed"),
  evidence("E-VIS-020", "Credibility / Advocacy", "Not Assessed"),
  evidence("E-SCA-001", "Retention", "Indeterminate"),
  evidence("E-CON-101", "Capture", "Partial", { pages: 7, pagesWithRoute: 1, dead: 7, distinctRouteLabels: 2 }),
  evidence("E-CON-102", "Capture", "Partial", {
    whatsapp: 0, booking: 0, tel: 0, mailto: 1, externalBooking: 0, conflicts: 5, totalRoutes: 1,
  }),
  evidence("E-CON-103", "Capture", "Pass", { forms: 17, substantive: 15, anyRequired: 1 }),
  evidence("E-RES-101", "Response", "Partial", { channels: 2, promisePages: 0 }),
  // Escalation evidence only ever appears when replaying a stored run log.
  evidence("ESC-001", "(escalation)", "Fail"),
];

const CIP: ClientIdentificationPacket = {
  businessName: "Example Advisory",
  businessType: "Financial Advisory",
  primaryDigitalAsset: "https://example.test/",
  detectedDigitalAssets: [],
  location: "Johannesburg",
  observedLanguages: ["English"],
  identificationConfidence: "Medium-High",
  identityConflicts: [{ field: "Address", details: "internal model prose that must never be published" }],
  notes: "internal",
  sector: "General",
  regulatorSensitive: false,
};

const INPUT: BusinessInput = {
  inputType: "Website URL",
  rawInputValue: "example.test",
  normalisedBusinessIdentifier: "example.test",
  normalisationStatus: "Success",
  normalisationNotes: "",
};

const PKG: EvidencePackage = { entries: ENTRIES, evidenceCoverage: "Partial — internal prose" };

const OBSERVED = {
  input: INPUT,
  cip: CIP,
  evidence: PKG,
  pagesFetched: [
    { url: "https://example.test/", status: 200 },
    { url: "https://example.test/about/", status: 200 },
    { url: "https://example.test/gone/", status: 404 },
    { url: "https://example.test/dead/", status: 0, error: "ETIMEDOUT" },
  ],
  robots: { disallows: ["/private"], blockedUrls: ["https://example.test/private/"] },
};

const SNAP: PublicSnapshot = buildPublicSnapshot(OBSERVED);

/** Every string in the payload that a human reads. Deliberately EXCLUDES URLs
 *  (`source`, `pagesInspected`), which are data, not prose. */
function proseOf(s: PublicSnapshot): string[] {
  return [
    s.businessRead,
    ...s.whatWeCanSee.flatMap((x) => [x.statement, x.proof]),
    ...s.whatIsWorking.flatMap((x) => [x.statement, x.proof]),
    ...s.whatWeCouldNotSettle.flatMap((x) => [x.question, x.reason]),
    s.evidenceConfidence,
    ...s.evidenceReceipt.limitations,
    s.boundaryNote,
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("=== 1. Type boundary: PublicSnapshot carries no judgement field ===");

const JUDGEMENT_FIELDS = [
  "primaryConstraint",
  "secondaryConstraints",
  "howFixingItWillHelp",
  "hypothesisConfidence",
  "reasoningNotes",
  "constraintSafety",
  "supportingEvidence",
  "contradictoryEvidence",
  "verificationRequired",
  "businessGoal",
  "expectedGrowthFunctions",
];
const serialised = JSON.stringify(SNAP);
for (const field of JUDGEMENT_FIELDS) {
  check(`payload has no "${field}" anywhere`, !serialised.includes(field));
}
check(
  "top-level keys are exactly the observation contract",
  JSON.stringify(Object.keys(SNAP).sort()) ===
    JSON.stringify(
      [
        "boundaryNote",
        "businessRead",
        "evidenceConfidence",
        "evidenceReceipt",
        "whatIsWorking",
        "whatWeCanSee",
        "whatWeCouldNotSettle",
      ].sort()
    ),
  Object.keys(SNAP).join(", ")
);

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n=== 2. Projection boundary: judgement is not reachable as input ===");

const projectionSource = read("src/projection/public-snapshot.ts");
const code = projectionSource
  .split("\n")
  .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*") && !l.trim().startsWith("/*"))
  .join("\n");

check("does not import Contract 4", !/from\s+"[^"]*contract4-reasoning/.test(code));
check("does not import Contract 5", !/from\s+"[^"]*contract5-snapshot/.test(code));
check("does not import the LLM client", !/from\s+"[^"]*llm\//.test(code));
check("never names ReasoningResult", !code.includes("ReasoningResult"));
check("never names GrowthSnapshot", !code.includes("GrowthSnapshot"));
check("never names GoalModel", !code.includes("GoalModel"));
for (const field of ["primaryConstraint", "secondaryConstraints", "hypothesisConfidence", "constraintSafety"]) {
  check(`projection code never reads ${field}`, !code.includes(field));
}
const inputBlock = projectionSource.slice(
  projectionSource.indexOf("export interface ObservationInput {"),
  projectionSource.indexOf("// ─── Presentation limits")
);
const declaredInputs = [...inputBlock.matchAll(/^\s{2}readonly (\w+)\??:/gm)].map((m) => m[1]).sort();
check(
  "ObservationInput declares only observation sources",
  JSON.stringify(declaredInputs) === JSON.stringify(["cip", "evidence", "input", "pagesFetched", "robots"]),
  declaredInputs.join(", ")
);
check("every ObservationInput member is readonly", !/^\s{2}(?!readonly )\w+\??:/m.test(inputBlock));
check(
  "escalation evidence is excluded by name",
  projectionSource.includes('const ESCALATION_FUNCTION = "(escalation)"')
);
check(
  "the escalation entry did not reach the payload",
  !serialised.includes("ESC-001"),
  serialised.slice(0, 160)
);

// Determinism / provider neutrality: the same evidence must always project to
// the same public Snapshot, with no model and no clock involved.
check(
  "projection is deterministic",
  JSON.stringify(buildPublicSnapshot(OBSERVED)) === serialised
);
const shuffled = buildPublicSnapshot({ ...OBSERVED, evidence: { ...PKG, entries: [...ENTRIES].reverse() } });
check(
  "input order does not change the output",
  JSON.stringify(shuffled) === serialised,
  "selection must depend on library order, never on arrival order"
);

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n=== 3. Selection rule carries no severity ===");

check(
  "only concluded checks are stated",
  [...SNAP.whatWeCanSee, ...SNAP.whatIsWorking].every((x) => x.evidenceId !== "E-CON-018")
);
check("Pass results are held separately as strengths", SNAP.whatIsWorking.length > 0);
check(
  "strengths are Pass-derived only",
  SNAP.whatIsWorking.every((x) => ["E-VIS-001", "E-VIS-003", "E-VIS-016", "E-VIS-004", "E-CON-103"].includes(x.evidenceId))
);
check("no evidence item is stated twice", (() => {
  const ids = SNAP.whatWeCanSee.map((x) => x.evidenceId);
  return new Set(ids).size === ids.length;
})());
check(
  "growth functions are spread round-robin, not dominated by one area",
  (() => {
    // The fixture's gaps are Discoverability (2), Capture (2) and Response (1).
    // A first-come rule would emit two Discoverability items before touching
    // Capture; round-robin must take one of each before any second item.
    const ids = SNAP.whatWeCanSee.filter((x) => x.evidenceId !== "CIP-CONFLICT").map((x) => x.evidenceId);
    return ids.length === 3 && ids[0].startsWith("E-VIS") && ids[1].startsWith("E-CON") && ids[2].startsWith("E-RES");
  })(),
  SNAP.whatWeCanSee.map((x) => x.evidenceId).join(", ")
);
check(
  "the list is filled to the cap when enough evidence concluded",
  SNAP.whatWeCanSee.filter((x) => x.evidenceId !== "CIP-CONFLICT").length === 3
);
check(
  "unresolved statuses become open questions, not statements",
  SNAP.whatWeCouldNotSettle.length > 0 && SNAP.whatWeCouldNotSettle.length <= 3
);
check(
  "three GBP items blocked by one missing method collapse to one line",
  SNAP.whatWeCouldNotSettle.filter((u) => u.reason.includes("Google Business Profile")).length === 1
);
check(
  "an unsettled reason always describes OUR limit, never a site defect",
  SNAP.whatWeCouldNotSettle.every((u) => /we |our |cannot|do not run|no way/i.test(u.reason))
);
check("selection rule is documented in code", /THE SELECTION RULE, stated in full/.test(projectionSource));
check(
  "the rule is explicitly forbidden from becoming a scoring engine",
  /must never be extended into\s*\/\/\s*a scoring engine/.test(projectionSource) ||
    projectionSource.includes("must never be extended into a scoring engine")
);

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n=== 4. Public prose states no constraint and no consequence ===");

const prose = proseOf(SNAP);
const allProse = prose.join(" ").toLowerCase();

for (const banned of ["constraint", "prioritis", "prioritiz", "ranked", "ranking", "most important", "single biggest", "worst", "most significant", "biggest issue"]) {
  check(`no public prose says "${banned}"`, !allProse.includes(banned));
}
// "matters most" is permitted in exactly one place: the boundary note, where it
// appears as a DISCLAIMER of the thing this product does not do.
const withoutBoundary = prose.filter((p) => p !== SNAP.boundaryNote).join(" ").toLowerCase();
check("only the boundary note may use \"matters most\"", !withoutBoundary.includes("matters most"));
check("the boundary note disclaims it explicitly", /does not decide which of these matters most/i.test(SNAP.boundaryNote));
check("the boundary note disclaims sequencing", /does not set an order of work/i.test(SNAP.boundaryNote));
check("the boundary note hands judgement to the Report", /that judgement is the growth report/i.test(SNAP.boundaryNote));
check("the shipped note is the reviewed constant", SNAP.boundaryNote === BOUNDARY_NOTE);

// Causal and prescriptive claims: the Snapshot describes, it does not promise.
for (const pattern of [
  /\bfixing (this|it|that)\b/i,
  /\bwill (increase|improve|lead to|result in|mean more|bring|help you)\b/i,
  /\bmore (enquiries|leads|customers|bookings|revenue)\b/i,
  /\byou should\b/i,
  /\bwe recommend\b/i,
  /\bstart (by|with)\b/i,
  /\bfirst,? (second|then)\b/i,
]) {
  check(`no public prose matches ${pattern}`, !pattern.test(prose.join(" ")));
}

// Internal vocabulary must not travel with the evidence. Every fixture entry
// above deliberately carries "Result Status", "usable", "static markup",
// "corpus" and "pipeline" in its internal fields.
for (const term of [
  "result status",
  "usable",
  "indeterminate",
  "requires browser confirmation",
  "growth function",
  "corpus",
  "run log",
  "static markup",
  "evidence item",
  "pipeline",
  "e-vis-",
  "e-con-",
]) {
  check(`no internal vocabulary: "${term}"`, !allProse.includes(term));
}
check(
  "model-authored identity prose never reaches the payload",
  !serialised.includes("internal model prose that must never be published")
);
check(
  "an identity discrepancy IS surfaced, by field name only",
  SNAP.whatWeCanSee.some((x) => x.evidenceId === "CIP-CONFLICT" && /address/i.test(x.statement))
);

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n=== 5. Confidence is about evidence, never about a finding ===");

check("confidence sentence reports coverage", /we settled \d+ of the \d+ things we looked at/i.test(SNAP.evidenceConfidence));
check("confidence carries no number as a grade or percentage", !/%/.test(SNAP.evidenceConfidence));
for (const overclaim of ["fairly confident", "clear finding", "confirmed", "definitely", "certainly", "we can see clearly"]) {
  check(`confidence never says "${overclaim}"`, !SNAP.evidenceConfidence.toLowerCase().includes(overclaim));
}

console.log("\n=== 6. Evidence receipt proves the inspection happened ===");
const r = SNAP.evidenceReceipt;
check("only successfully read pages are claimed as read", r.pagesInspectedCount === 2, String(r.pagesInspectedCount));
check("a 404 is not counted as inspected", !r.pagesInspected.some((u) => u.includes("/gone/")));
check("an errored fetch is not counted as inspected", !r.pagesInspected.some((u) => u.includes("/dead/")));
check("checks run and checks settled are both reported", r.signalsChecked === ENTRIES.length && r.signalsSettled > 0);
check("settled never exceeds checked", r.signalsSettled <= r.signalsChecked);
check("robots-blocked pages are declared, not hidden", r.notInspected.includes("https://example.test/private/"));
check("limitations name the no-JavaScript limit", r.limitations.some((l) => /scripts a browser runs/i.test(l)));
check("limitations name the local-search blind spot", r.limitations.some((l) => /google business profile/i.test(l)));
check(
  "limitations refuse any findability claim",
  r.limitations.some((l) => /nothing here describes how findable/i.test(l))
);
check("limitations state nothing was submitted or used", r.limitations.some((l) => /no form was submitted/i.test(l)));
check("robots exclusion is stated as a count", r.limitations.some((l) => /robots\.txt/i.test(l)));

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n=== 7. Wire boundary: the terminal payload carries only the projection ===");

const server = read("src/web/server.ts");
const resultBlock = server.slice(server.indexOf('type: "result"'), server.indexOf('type: "result"') + 400);
check("terminal result sends publicSnapshot", /publicSnapshot: log\.publicSnapshot/.test(resultBlock));
check("terminal result does NOT send growthSnapshot", !/snapshot: log\.growthSnapshot/.test(server));
for (const field of ["primaryConstraint", "secondaryConstraints", "howFixingItWillHelp", "reasoningNotes"]) {
  check(`server never writes ${field} to the wire`, !new RegExp(`write\\([^)]*${field}`).test(server));
}
check("the email path reads publicSnapshot", /found\.log\.publicSnapshot/.test(server));
check("the email path never reads growthSnapshot", !/found\.log\.growthSnapshot/.test(server));

console.log("\n=== 8. Public milestones describe activity, not judgement ===");
const milestones = server.slice(server.indexOf("const MILESTONES"), server.indexOf("];", server.indexOf("const MILESTONES")));
check("no milestone announces choosing a constraint", !/most limiting|constraint|diagnos/i.test(milestones));
check("Contract 4's milestone is neutral", /Reviewing what the evidence does and does not settle/.test(milestones));
check("every pipeline stage still reports", (milestones.match(/\["Contract|\["Site corpus/g) ?? []).length === 7);

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n=== 9. Frontend boundary: neither surface can render a constraint ===");

for (const [label, rel] of [
  ["Astro Snapshot page", "website/src/pages/snapshot.astro"],
  ["Astro client", "website/src/lib/snapshot-client.ts"],
  ["legacy Railway frontend", "src/web/index.html"],
] as const) {
  const src = read(rel);
  const body = rel.endsWith(".astro") || rel.endsWith(".ts")
    ? src.split("\n").filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*")).join("\n")
    : src.replace(/<!--[\s\S]*?-->/g, "");
  for (const field of ["primaryConstraint", "secondaryConstraints", "howFixingItWillHelp", "whatIsGoingWell", "verificationRequired"]) {
    check(`${label} never reads ${field}`, !body.includes(field));
  }
  check(`${label} makes no "single biggest" claim`, !/single biggest|biggest growth constraint/i.test(body));
  check(`${label} claims no diagnosis`, !/diagnosis of the one thing|we diagnose (your|the) (main )?constraint/i.test(body));
}

const astro = read("website/src/pages/snapshot.astro");
for (const heading of ["What we can see", "What is working", "What we could not settle", "Confidence", "Evidence receipt"]) {
  check(`Astro renders the approved section "${heading}"`, astro.includes(`<h3>${heading}</h3>`));
}
check("Astro states the boundary above the form", /does not diagnose your main constraint or\s*prescribe the order of work/.test(astro));
check("the closed KNOWN GAP is recorded, not silently dropped", /KNOWN GAP — NOW CLOSED/.test(astro));
check("Astro renders the payload's own boundary note", /setText\("result-boundary", s\.boundaryNote\)/.test(astro));
check(
  "analytics carries no property derived from the result content",
  /track\(SNAPSHOT_COMPLETED, \{\s*durationBucket: durationBucket\(performance\.now\(\) - startedAt\),\s*\}\)/.test(astro)
);

const legacy = read("src/web/index.html");
check("legacy frontend reads publicSnapshot", legacy.includes("final.publicSnapshot"));
check("legacy frontend states the boundary", /does not diagnose your main constraint/.test(legacy));
check("legacy frontend renders the receipt", legacy.includes('id="receiptSummary"'));

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n=== 10. Email boundary: observation-safe language only ===");

const emailSource = read("src/email.ts");
check("email cannot import GrowthSnapshot", !emailSource.includes("GrowthSnapshot }") && !/type \{[^}]*GrowthSnapshot/.test(emailSource));
check("email types its input as PublicSnapshot", /snapshot: PublicSnapshot/.test(emailSource));

const html = renderSnapshotEmailHtml("Example Advisory", SNAP);
const emailText = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").toLowerCase();
for (const banned of ["single biggest constraint", "primary constraint", "main constraint", "prioritised growth plan", "first, second, third"]) {
  check(`email never says "${banned}"`, !emailText.includes(banned));
}
// "matters most" is allowed in the email for the same reason it is allowed in
// the boundary note: it appears only as a statement of what this free product
// does NOT do, and hands that work to the Report. What is banned is the claim.
check(
  "email never claims the Snapshot identifies anything",
  !/(snapshot|we) (identifies|identify|finds|found|names) the/i.test(emailText)
);
check(
  "email's use of \"matters most\" is a disclaimer",
  emailText.includes("deciding which of it matters most is a different kind of work")
);
check("email leads with the business read, not a finding", html.includes(SNAP.businessRead));
check("email carries the boundary note", emailText.includes("that judgement is the growth report"));
check("email renders the evidence receipt", /what we looked at/i.test(emailText));
check("email places judgement with the Growth Report", /growth report .{0,80}judgement layer|judgement layer/i.test(emailText));
check("email describes the Blueprint as conditional", /only where\s*a growth report shows it is warranted|only where a growth report shows it is warranted/i.test(emailText));
check("email no longer says the paid tiers cannot be ordered", !emailText.includes("neither is available to order"));
check("email states the ratified availability", /available by enquiry/i.test(emailText));
check("email invents no price", !/\br\s?\d|\$\d|usd|price|pricing/i.test(emailText));

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n=== 11. Fallback boundary: no state promises to name a constraint ===");

const gated = buildUnconfirmedSnapshot();
const gatedText = Object.values(gated).filter((v) => typeof v === "string").join(" ").toLowerCase();
check("gated copy no longer promises to name a main constraint", !gatedText.includes("main constraint"));
check("gated copy no longer promises to name YOUR constraint", !/name (your|the) constraint/.test(gatedText));
check("gated copy contains no constraint promise at all", !gatedText.includes("constraint"));
check("gated copy still leads with the review having happened", gated.primaryConstraint.startsWith("We reviewed your public pages"));
check("gated flag preserved for internal observability", gated.verificationRequired === true);

const states = read("website/src/lib/snapshot-states.ts");
check("no failure state names a constraint", !/constraint/i.test(states));
check("no failure state uses the retired product name", !/growth audit/i.test(states));

const guards = read("src/web/guards.ts");
check("rate-limit copy uses the current product name", /instant Growth Snapshots/.test(guards));
check("capacity copy uses the current product name", /capacity for Growth Snapshots/.test(guards));
check("no guard copy says Growth Audit", !/Growth Audit/.test(guards));
check("no server copy says Growth Audit", !/Growth Audit/.test(server));
check("no legacy frontend copy says Growth Audit", !/Growth Audit/.test(legacy));

// Empty-list copy is a public surface too, and must hold the same line.
const emptyProse = Object.values(EMPTY_STATE).join(" ").toLowerCase();
check("empty-state copy names no constraint", !emptyProse.includes("constraint"));
check("empty-state copy blames our reach, not the business", emptyProse.includes("not a verdict on your business"));

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n=== 12. Internal reasoning is preserved, not deleted ===");

const types = read("src/types.ts");
for (const field of ["primaryConstraint", "secondaryConstraints", "hypothesisConfidence", "supportingEvidence", "contradictoryEvidence", "constraintSafety", "reasoningNotes"]) {
  check(`ReasoningResult still carries ${field}`, types.includes(field));
}
check("GrowthSnapshot type still exists for internal use", /export interface GrowthSnapshot \{/.test(types));
check("RunLog still stores reasoningResult", /reasoningResult\?: ReasoningResult/.test(types));
check("RunLog still stores growthSnapshot", /growthSnapshot\?: GrowthSnapshot/.test(types));
check("RunLog now also stores the public projection", /publicSnapshot\?: PublicSnapshot/.test(types));

const pipeline = read("src/pipeline.ts");
check("Contract 4 still runs", /runContract4\(/.test(pipeline));
check("Contract 5 still runs", /runContract5\(/.test(pipeline));
check("the projection is built from the evidence layer", /buildPublicSnapshot\(\{/.test(pipeline));
check(
  "the projection is built BEFORE the reasoning stages",
  pipeline.indexOf("buildPublicSnapshot") < pipeline.indexOf("runContract4(")
);

const assembler = read("tools/assemble-report.ts");
check("the Growth Report still diagnoses from reasoningResult", /rr!\.primaryConstraint/.test(assembler));
check("the Growth Report still reads secondary constraints", /rr!\.secondaryConstraints/.test(assembler));
check("the Growth Report does not take its diagnosis from the public Snapshot", !/publicSnap\.(whatWeCanSee|businessRead)[^\n]*emphasis/.test(assembler));
check("the assembler distinguishes what the client saw from the internal draft", /INTERNAL Snapshot draft — never shown to this client/.test(assembler));

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n=== 13. The whole public path still wires together ===");

// Typechecking proves the shapes agree; this proves the modules actually
// resolve and export what their callers reach for. Import-time only — the
// pipeline is never run, so no site is fetched and no provider is called.
const pipelineModule = await import("../src/pipeline.js");
const contract5Module = await import("../src/contracts/contract5-snapshot.js");
const emailModule = await import("../src/email.js");
const projectionModule = await import("../src/projection/public-snapshot.js");

check("pipeline module resolves", typeof pipelineModule.runPipeline === "function");
check("Contract 5 is still wired and exported", typeof contract5Module.runContract5 === "function");
check("the Contract 5 gate helper survives", typeof contract5Module.isConstraintGated === "function");
check("email renderer resolves", typeof emailModule.renderSnapshotEmailHtml === "function");
check("email sender resolves", typeof emailModule.sendSnapshotEmail === "function");
check("projection builder resolves", typeof projectionModule.buildPublicSnapshot === "function");
check("the reviewed boundary note is exported for every surface", projectionModule.BOUNDARY_NOTE === BOUNDARY_NOTE);
check(
  "a Snapshot renders to email end to end",
  renderSnapshotEmailHtml("Example Advisory", SNAP).startsWith("<!doctype html>")
);

// `--print` follows the convention in phase11-snapshot-safety.ts: let a
// reviewer read verbatim what a stranger would receive, without running a
// pipeline. Same fixture the checks above ran against.
if (process.argv.includes("--print")) {
  console.log("\n--- PUBLIC SNAPSHOT (fixture) ---");
  console.log(JSON.stringify(SNAP, null, 2));
  console.log("\n--- EMAIL, AS TEXT ---");
  console.log(
    html
      .replace(/<(style|script)[\s\S]*?<\/\1>/g, "")
      .replace(/<\/(tr|div|td|p)>/g, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&mdash;/g, "—")
      .replace(/&middot;/g, "·")
      .replace(/&nbsp;/g, " ")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .join("\n")
  );
}

console.log(`\n${failed === 0 ? "ALL PASSED" : `${failed} CHECK(S) FAILED`}`);
process.exit(failed === 0 ? 0 : 1);
