// Stage 1.1 — the public/internal failure boundary, exercised for real.
// No network, no LLM calls, no cost. Run: npx tsx test/failure-boundary.ts
//
//   A completed public observation must not fail merely because later internal
//   diagnostic reasoning failed.
//
// These are BEHAVIOURAL tests, not source scans: the real pipeline runs end to
// end against a stubbed `globalThis.fetch` serving a fixture site, with the mock
// provider standing in for the model. Failures are injected at a named stage via
// DRDS_MOCK_FAIL_PROMPT, so "Contract 4 collapsed" is a thing that actually
// happens here rather than a thing the test asserts about a comment.
//
// Nothing reaches the network: every fetch is intercepted, the provider is
// explicitly `mock`, and every run log the pipeline writes is deleted again.

import { unlinkSync } from "node:fs";
import { runPipeline } from "../src/pipeline.js";
import { renderSnapshotEmailHtml } from "../src/email.js";
import { assemble } from "../tools/assemble-report.js";
import type { RunLog } from "../src/types.js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string): string => readFileSync(join(ROOT, rel), "utf8");

let failed = 0;
function check(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond || !detail ? "" : `  -> ${detail}`}`);
  if (!cond) failed++;
}

// ─── Fixture site ────────────────────────────────────────────────────────────

const PAGE = (title: string, h1: string, extra = ""): string => `<!doctype html>
<html><head>
  <title>${title}</title>
  <meta name="description" content="Description for ${title}, distinct from the others.">
</head><body>
  <h1>${h1}</h1>
  <nav>
    <a href="/">Home</a>
    <a href="/about/">About</a>
    <a href="/services/">Services</a>
    <a href="/contact/">Contact</a>
  </nav>
  <p>Example Advisory helps owners with planning. We are based in Testville.</p>
  ${extra}
</body></html>`;

const SITE: Record<string, string> = {
  "https://example.test/": PAGE("Example Advisory — Home", "Example Advisory", '<a href="tel:+27110000000">Call us</a>'),
  "https://example.test/about/": PAGE("About — Example Advisory", "About us"),
  "https://example.test/services/": PAGE("Services — Example Advisory", "What we do"),
  "https://example.test/contact/": PAGE(
    "Contact — Example Advisory",
    "Contact us",
    `<a href="tel:+27110000000">Call us</a>
     <form action="/send" method="post">
       <input type="text" name="name" placeholder="Your name" required>
       <input type="email" name="email" placeholder="Your email" required>
       <textarea name="message" placeholder="How can we help?"></textarea>
     </form>`
  ),
};

const ORIGINAL_FETCH = globalThis.fetch;
let unreachable = false;

function stubbedResponse(url: string): Response {
  if (unreachable) throw new TypeError("fetch failed");
  const body = SITE[url];
  const res = body
    ? new Response(body, { status: 200, headers: { "Content-Type": "text/html" } })
    : new Response("not found", { status: 404, headers: { "Content-Type": "text/plain" } });
  // A constructed Response has url === "", and the fetcher resolves relative
  // hrefs against it. Without this every link on the page becomes unparsable.
  Object.defineProperty(res, "url", { value: url });
  return res;
}

globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  return stubbedResponse(url);
}) as typeof fetch;

// ─── Environment ─────────────────────────────────────────────────────────────

const ORIGINAL_ENV = {
  provider: process.env.DRDS_LLM_PROVIDER,
  failPrompt: process.env.DRDS_MOCK_FAIL_PROMPT,
};
process.env.DRDS_LLM_PROVIDER = "mock";

const writtenLogs: string[] = [];

/** One real pipeline run, with an optional injected stage failure. */
async function run(failPrompt?: string): Promise<RunLog> {
  if (failPrompt) process.env.DRDS_MOCK_FAIL_PROMPT = failPrompt;
  else delete process.env.DRDS_MOCK_FAIL_PROMPT;
  const { log, logFile } = await runPipeline("https://example.test/");
  writtenLogs.push(logFile);
  return log;
}

function cleanup(): void {
  globalThis.fetch = ORIGINAL_FETCH;
  if (ORIGINAL_ENV.provider === undefined) delete process.env.DRDS_LLM_PROVIDER;
  else process.env.DRDS_LLM_PROVIDER = ORIGINAL_ENV.provider;
  if (ORIGINAL_ENV.failPrompt === undefined) delete process.env.DRDS_MOCK_FAIL_PROMPT;
  else process.env.DRDS_MOCK_FAIL_PROMPT = ORIGINAL_ENV.failPrompt;
  for (const file of writtenLogs) {
    try {
      unlinkSync(file);
    } catch {
      /* already gone — nothing to clean */
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("=== 4. Successful full path is unchanged ===");

const ok = await run();
check("public Snapshot produced", ok.publicSnapshot !== undefined);
check("no public failure", ok.failure === undefined, JSON.stringify(ok.failure));
check("no internal failure", ok.internalFailure === undefined, JSON.stringify(ok.internalFailure));
check("internal reasoning retained", ok.reasoningResult !== undefined);
check("internal Snapshot retained", ok.growthSnapshot !== undefined);
check("run log carries BOTH artefacts", ok.publicSnapshot !== undefined && ok.growthSnapshot !== undefined);
check("evidence layer retained", (ok.evidencePackage?.entries.length ?? 0) > 0);
check("pages were genuinely read", ok.pagesFetched.some((p) => p.status === 200));
check("usage was collected", ok.llmUsage !== undefined && ok.llmUsage.totals.llmCalls > 0);
check(
  "every pipeline stage completed",
  ok.stages.every((s) => s.status === "completed"),
  ok.stages.filter((s) => s.status !== "completed").map((s) => s.stage).join(", ")
);

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n=== 1. Failure BEFORE the public Snapshot keeps the old semantics ===");

{
  const early = await run("cip-identification");
  check("no public Snapshot was built", early.publicSnapshot === undefined);
  check("public failure IS set", early.failure !== undefined, JSON.stringify(early.failure));
  check("it is not misfiled as an internal failure", early.internalFailure === undefined);
  check("failure is classified, not raw", early.failure?.stage === "unexpected", early.failure?.stage);
  check("no reasoning was produced", early.reasoningResult === undefined);
  check("no internal Snapshot was produced", early.growthSnapshot === undefined);
}

{
  // The site itself cannot be reached: Contract 0 fails, exactly as before.
  unreachable = true;
  const dead = await run();
  unreachable = false;
  check("unreachable site produces no public Snapshot", dead.publicSnapshot === undefined);
  check("unreachable site sets the public failure", dead.failure?.stage === "Contract 0", JSON.stringify(dead.failure));
  check("unreachable site sets no internal failure", dead.internalFailure === undefined);
  check("fail-closed behaviour is unweakened", dead.failure !== undefined);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n=== 2. Contract 4 failure AFTER the public projection ===");

const c4Failed = await run("cder-reasoning");
check("public Snapshot SURVIVES", c4Failed.publicSnapshot !== undefined);
check("public failure is NOT set", c4Failed.failure === undefined, JSON.stringify(c4Failed.failure));
check("internal failure IS recorded", c4Failed.internalFailure !== undefined);
check("internal failure names Contract 4", c4Failed.internalFailure?.stage === "Contract 4", c4Failed.internalFailure?.stage);
check("internal failure is classified", /^unexpected: /.test(c4Failed.internalFailure?.reason ?? ""), c4Failed.internalFailure?.reason);
check("no reasoning result exists", c4Failed.reasoningResult === undefined);
check(
  "Contract 5 did NOT invent a substitute diagnosis",
  c4Failed.growthSnapshot === undefined,
  JSON.stringify(c4Failed.growthSnapshot)
);
check(
  "Contract 5 was never even started",
  !c4Failed.stages.some((s) => s.stage.startsWith("Contract 5")),
  c4Failed.stages.map((s) => s.stage).join(" | ")
);
check(
  "the failed stage is recorded in the stage trace",
  c4Failed.stages.some((s) => s.stage.startsWith("Contract 4") && s.status === "failed")
);
check("all observation data is preserved", (c4Failed.evidencePackage?.entries.length ?? 0) > 0);
check("the CIP is preserved", c4Failed.cip !== undefined);
check("pages fetched are preserved", c4Failed.pagesFetched.length > 0);

console.log("\n--- the surviving public payload ---");
const survivor = c4Failed.publicSnapshot!;
const wire = JSON.stringify(survivor);
for (const field of [
  "primaryConstraint",
  "secondaryConstraints",
  "howFixingItWillHelp",
  "hypothesisConfidence",
  "reasoningNotes",
  "constraintSafety",
  "internalFailure",
]) {
  check(`payload carries no "${field}"`, !wire.includes(field));
}
check("payload is a complete observation", survivor.whatWeCanSee.length + survivor.whatIsWorking.length > 0);
check("payload carries its receipt", survivor.evidenceReceipt.pagesInspectedCount > 0);
check("payload carries the boundary note", /That judgement is the Growth Report\.$/.test(survivor.boundaryNote));
check(
  "payload is identical to the one a fully successful run produced",
  JSON.stringify(survivor) === JSON.stringify(ok.publicSnapshot),
  "the reasoning stages must not influence the public product at all"
);
// The mock provider stamps "[MOCK]" on the business name it invents, so that
// string legitimately appears in a mock run's payload. What must never appear is
// the FAILURE: its text, its reason, or the seam that injected it.
check(
  "the injected failure's text did not leak into the payload",
  !wire.includes("Injected failure") && !wire.includes("DRDS_MOCK_FAIL_PROMPT")
);
check(
  "the recorded internal reason did not leak into the payload",
  !wire.includes(c4Failed.internalFailure!.reason),
  c4Failed.internalFailure!.reason
);
check("the payload names no Contract", !/Contract \d/.test(wire));

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n=== 3. Contract 5 failure AFTER the public projection ===");

const c5Failed = await run("snapshot-copywriting");
check("public Snapshot SURVIVES", c5Failed.publicSnapshot !== undefined);
check("public failure is NOT set", c5Failed.failure === undefined, JSON.stringify(c5Failed.failure));
check("internal failure IS recorded", c5Failed.internalFailure !== undefined);
check("internal failure names Contract 5", c5Failed.internalFailure?.stage === "Contract 5", c5Failed.internalFailure?.stage);
check("Contract 4's reasoning is retained", c5Failed.reasoningResult !== undefined);
check("no internal Snapshot exists", c5Failed.growthSnapshot === undefined);
check(
  "the failed stage is recorded in the stage trace",
  c5Failed.stages.some((s) => s.stage.startsWith("Contract 5") && s.status === "failed")
);
const wire5 = JSON.stringify(c5Failed.publicSnapshot);
check("public contract remains observation-only", !wire5.includes("primaryConstraint") && !wire5.includes("Constraint"));
check(
  "public payload is unchanged by the internal failure",
  wire5 === JSON.stringify(ok.publicSnapshot)
);

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n=== Internal failure is distinguishable from public success ===");

const server = read("src/web/server.ts");
check("the terminal branch keys on the public product", /if \(!log\.publicSnapshot\) \{/.test(server));
check("it no longer keys on log.failure", !/if \(log\.failure\) \{\s*\n\s*const \{ state, message \}/.test(server));
check("an internal failure is logged loudly", server.includes("PV_INTERNAL_REASONING_FAILED"));
check("the internal log line carries the stage", /stage: log\.internalFailure\.stage/.test(server));
check("the internal log line carries the reason", /reason: log\.internalFailure\.reason/.test(server));
check("run summary reports the public outcome as status", /status: log\.failure \? "failed" : "completed"/.test(server));
check("run summary distinguishes the public projection", /publicSnapshot: log\.publicSnapshot \? "completed" : "absent"/.test(server));
check("run summary distinguishes internal reasoning", /internalReasoning: stageState\(/.test(server));
check("run summary distinguishes the internal Snapshot", /internalSnapshot: stageState\(/.test(server));
check("a stage that never ran is not reported as failed", server.includes('"not reached"'));
check(
  "the internal failure never reaches a response body",
  !/write\(\{[^}]*internalFailure/.test(server) && !/message:[^\n]*internalFailure/.test(server)
);

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n=== 7. Cost and budget accounting survive an internal failure ===");

check("usage was still collected", c4Failed.llmUsage !== undefined);
check("the run is NOT treated as zero-call", (c4Failed.llmUsage?.totals.llmCalls ?? 0) > 0, String(c4Failed.llmUsage?.totals.llmCalls));
check(
  "the failed provider call is recorded, not swallowed",
  (c4Failed.llmUsage?.totals.failedCalls ?? 0) > 0,
  String(c4Failed.llmUsage?.totals.failedCalls)
);
check(
  "calls made BEFORE the failure are all still accounted for",
  (c4Failed.llmUsage?.calls.filter((c) => c.status === "success").length ?? 0) >= 3,
  String(c4Failed.llmUsage?.calls.length)
);
check(
  "spend recording is still driven by collected usage, not by success",
  /if \(log\.llmUsage && log\.llmUsage\.totals\.estimatedCostUsd > 0\)/.test(server)
);
check(
  "spend is recorded before the terminal branch is chosen",
  server.indexOf("recordSpend(") < server.indexOf("if (!log.publicSnapshot)")
);
const guards = read("src/web/guards.ts");
check("daily budget check is unchanged and still pre-run", /dailyBudgetCheck/.test(server) && /export function dailyBudgetCheck/.test(guards));
check("budget guard still fails closed on unknown state", guards.includes("known: false"));

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n=== 5. Growth Report tooling refuses a reasoning-failed run ===");

let refused = "";
try {
  assemble(c4Failed, "test-fixture.json");
  refused = "(no error thrown)";
} catch (err) {
  refused = err instanceof Error ? err.message : String(err);
}
check("assembly THROWS for a reasoning-failed run", refused !== "(no error thrown)", refused);
check("it names the missing reasoning", /Contract 4 \(Reasoning\)/.test(refused), refused);
check("it explains that the Snapshot was still delivered", /delivered to the client/i.test(refused), refused);
check(
  "it states an observation cannot stand in for a diagnosis",
  /observation, not a diagnosis/i.test(refused),
  refused
);
check("it does not tell the founder to pick a successful run", !/choose a successful run log/i.test(refused));
check(
  "a completed publicSnapshot alone is never enough",
  c4Failed.publicSnapshot !== undefined && refused !== "(no error thrown)"
);

const c5Draft = assemble(c5Failed, "test-fixture.json");
check("a Contract 5 failure still assembles (the diagnosis survived)", c5Draft.length > 0);
check("but the founder is warned", /Internal reasoning did not fully complete/.test(c5Draft));
check("the warning names the failed stage", /Contract 5 failed/.test(c5Draft));
check("the warning says the client was unaffected", /public Growth Snapshot was delivered and is unaffected/.test(c5Draft));
check("a clean run carries no such warning", !/Internal reasoning did not fully complete/.test(assemble(ok, "test-fixture.json")));
check("the diagnosis still comes from Contract 4", assemble(ok, "test-fixture.json").includes(ok.reasoningResult!.primaryConstraint));

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n=== 6. Email works from the surviving public projection ===");

const html = renderSnapshotEmailHtml(c4Failed.cip?.businessName ?? "Your business", c4Failed.publicSnapshot!);
const emailText = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
check("an email renders from a reasoning-failed run", html.startsWith("<!doctype html>"));
check("it does not require an internal Snapshot", c4Failed.growthSnapshot === undefined && html.length > 0);
check("it carries the observation content", emailText.includes("What we can see"));
check("it carries the boundary note", /That judgement is the Growth Report/.test(emailText));
check(
  "no internal failure text reaches the reader",
  !/Injected failure|DRDS_MOCK_FAIL_PROMPT|Contract \d|unexpected:/.test(emailText)
);
check(
  "the recorded internal reason does not reach the reader",
  !emailText.includes(c4Failed.internalFailure!.reason)
);
check("no judgement field reaches the reader", !/primaryConstraint|constraint we could find|single biggest/i.test(emailText));

check("the email route reads publicSnapshot", /found\.log\.publicSnapshot/.test(server));
check("the email route has no growthSnapshot fallback", !/found\.log\.growthSnapshot/.test(server));
const emailSource = read("src/email.ts");
// The word appears once, in the header comment explaining what this module used
// to render. What matters is that no import or type annotation reaches it.
check("the renderer does not import the internal Snapshot type", !/^import[^\n]*GrowthSnapshot/m.test(emailSource));
check("the renderer has no GrowthSnapshot type annotation", !/:\s*GrowthSnapshot\b/.test(emailSource));
check("the renderer is typed to the public contract", /snapshot: PublicSnapshot/.test(emailSource));

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n=== Milestones were not faked ===");

check("no early-completion milestone was invented", /Finalising your Growth Snapshot/.test(server));
check(
  "a skipped Contract 5 emits no Contract 5 milestone",
  !c4Failed.stages.some((s) => s.stage.startsWith("Contract 5"))
);
check("approved neutral wording is unchanged", server.includes("Reviewing what the evidence does and does not settle"));

cleanup();
console.log(`\n${failed === 0 ? "ALL PASSED" : `${failed} CHECK(S) FAILED`}`);
process.exit(failed === 0 ? 0 : 1);
