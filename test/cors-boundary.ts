// Browser origin boundary for the public API.
// No network, no LLM calls, no cost. Run: npx tsx test/cors-boundary.ts
//
// The Website V2 site is a separate static deployment, so its browser client is
// cross-origin by design. This suite pins the boundary that makes that safe:
//
//   · an explicit allowlist, never a wildcard;
//   · bad configuration fails CLOSED — it can never become "allow all";
//   · a preflight is answered before any rate limit, budget or provider work;
//   · a browser must be able to READ every honest failure state, not just the
//     success path, or the site shows an opaque CORS error instead of the truth;
//   · a request with no Origin header behaves exactly as it always did, which is
//     what CLI use and engineering tooling depend on.

import {
  corsConfigSummary,
  corsHeaders,
  normaliseOrigin,
  preflightHeaders,
  readAllowedOrigins,
  resolveCors,
} from "../src/web/cors.js";

let failed = 0;
function check(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond || !detail ? "" : `  -> ${detail}`}`);
  if (!cond) failed++;
}

const SITE = "https://drdigitalsystems.co.za";
const DEV = "http://localhost:4321";

// ────────────────────────────────────────────────────────────────
console.log("=== 1. Allowlist parsing ===");

check("single origin parses", readAllowedOrigins(SITE).has(SITE));
const multi = readAllowedOrigins(`${SITE},${DEV}`);
check("comma-separated origins parse", multi.has(SITE) && multi.has(DEV), `${[...multi]}`);
check("multiple entries are counted", multi.size === 2);

const spaced = readAllowedOrigins(`  ${SITE} ,\t${DEV}  `);
check("surrounding whitespace is harmless", spaced.has(SITE) && spaced.has(DEV), `${[...spaced]}`);

check("trailing slash normalises to the same origin", readAllowedOrigins(`${SITE}/`).has(SITE));
check("a path collapses to its origin", readAllowedOrigins(`${SITE}/snapshot/`).has(SITE));
check(
  "slash and no-slash are ONE entry, not two",
  readAllowedOrigins(`${SITE},${SITE}/`).size === 1
);
check("port is part of the origin", readAllowedOrigins(DEV).has(DEV) && !readAllowedOrigins(DEV).has("http://localhost"));
check("scheme is part of the origin", !readAllowedOrigins(SITE).has("http://drdigitalsystems.co.za"));

console.log("\n=== 2. Bad configuration fails closed, never open ===");

const BAD: [label: string, value: string | undefined][] = [
  ["unset", undefined],
  ["empty", ""],
  ["whitespace", "   "],
  ["commas only", ",,,"],
  ["wildcard", "*"],
  ["wildcard among entries", `*,${SITE}`],
  ["not a URL", "drdigitalsystems.co.za"],
  ["scheme-relative", "//drdigitalsystems.co.za"],
  ["unsupported scheme", "file:///etc/passwd"],
  ["javascript scheme", "javascript:alert(1)"],
  ["literal null", "null"],
];

for (const [label, value] of BAD) {
  const allowed = readAllowedOrigins(value);
  // A wildcard entry must be dropped, not honoured — but a VALID entry beside it
  // still stands, which is why this asserts on the wildcard's absence.
  check(`\`${label}\` never yields a wildcard`, !allowed.has("*"), `${[...allowed]}`);
  const decision = resolveCors(SITE, allowed);
  const expectAllowed = label === "wildcard among entries";
  check(
    `\`${label}\` ${expectAllowed ? "keeps the valid entry" : "denies a browser origin"}`,
    expectAllowed ? decision.kind === "allowed" : decision.kind === "denied",
    decision.kind
  );
}

check("empty allowlist denies everything", resolveCors(SITE, readAllowedOrigins("")).kind === "denied");
check("normaliseOrigin rejects the wildcard outright", normaliseOrigin("*") === null);

console.log("\n=== 3. Decision for a request ===");

const allow = readAllowedOrigins(`${SITE},${DEV}`);
check("allowlisted origin is allowed", resolveCors(SITE, allow).kind === "allowed");
check("dev origin is allowed", resolveCors(DEV, allow).kind === "allowed");
check("unknown origin is denied", resolveCors("https://evil.example", allow).kind === "denied");
check("near-miss host is denied", resolveCors("https://drdigitalsystems.co.za.evil.example", allow).kind === "denied");
check("subdomain is denied", resolveCors("https://www.drdigitalsystems.co.za", allow).kind === "denied");
check("wrong scheme is denied", resolveCors("http://drdigitalsystems.co.za", allow).kind === "denied");
check("wrong port is denied", resolveCors("http://localhost:4322", allow).kind === "denied");
check("sandboxed `null` origin is denied", resolveCors("null", allow).kind === "denied");
check("array header takes the first value", resolveCors([SITE, "https://evil.example"], allow).kind === "allowed");

console.log("\n--- no Origin header: existing direct behaviour is preserved ---");
check("undefined Origin -> no-origin", resolveCors(undefined, allow).kind === "no-origin");
check("empty Origin -> no-origin", resolveCors("", allow).kind === "no-origin");
check("whitespace Origin -> no-origin", resolveCors("   ", allow).kind === "no-origin");
check(
  "no-origin holds even with NO allowlist configured",
  resolveCors(undefined, readAllowedOrigins(undefined)).kind === "no-origin"
);
check("no-origin adds no headers at all", Object.keys(corsHeaders({ kind: "no-origin" })).length === 0);

console.log("\n=== 4. Response headers ===");

const allowedHeaders = corsHeaders(resolveCors(SITE, allow));
check("allowed origin is echoed exactly", allowedHeaders["Access-Control-Allow-Origin"] === SITE);
check("allowed response sends Vary: Origin", allowedHeaders["Vary"] === "Origin");
check("wildcard is never emitted", allowedHeaders["Access-Control-Allow-Origin"] !== "*");
check(
  "credentials are not enabled",
  !("Access-Control-Allow-Credentials" in allowedHeaders),
  JSON.stringify(allowedHeaders)
);

const deniedHeaders = corsHeaders(resolveCors("https://evil.example", allow));
check("denied response sends NO allow-origin", !("Access-Control-Allow-Origin" in deniedHeaders));
check("denied response still sends Vary: Origin", deniedHeaders["Vary"] === "Origin", JSON.stringify(deniedHeaders));

console.log("\n=== 5. Preflight contract ===");

const pre = preflightHeaders(resolveCors(DEV, allow));
check("preflight echoes the origin", pre["Access-Control-Allow-Origin"] === DEV);
check("preflight sends Vary: Origin", pre["Vary"] === "Origin");
check("preflight allows POST and OPTIONS", pre["Access-Control-Allow-Methods"] === "POST, OPTIONS");
check("preflight allows Content-Type", pre["Access-Control-Allow-Headers"] === "Content-Type");
check("preflight sets a bounded Max-Age", Number(pre["Access-Control-Max-Age"]) > 0 && Number(pre["Access-Control-Max-Age"]) <= 86400);
check("preflight advertises no other method", !/GET|PUT|DELETE|PATCH/.test(pre["Access-Control-Allow-Methods"] ?? ""));

const preDenied = preflightHeaders(resolveCors("https://evil.example", allow));
check("denied preflight sends no allow-origin", !("Access-Control-Allow-Origin" in preDenied));

console.log("\n=== 6. The boundary leaks nothing ===");

const summary = corsConfigSummary(allow);
check("summary reports a count, not the origins", !summary.includes(SITE) && !summary.includes(DEV), summary);
check("summary of an empty allowlist says so plainly", corsConfigSummary(readAllowedOrigins("")).includes("no browser origins"));

const source = await import("node:fs").then((fs) =>
  fs.readFileSync(new URL("../src/web/cors.ts", import.meta.url), "utf8")
);
for (const vendor of ["anthropic", "openai", "claude", "gpt-", "@anthropic-ai"]) {
  check(`cors.ts names no model vendor: "${vendor}"`, !source.toLowerCase().includes(vendor));
}
check("cors.ts hard-codes no production origin", !source.includes("drdigitalsystems.co.za"));
check("cors.ts never emits a wildcard allow-origin", !/Allow-Origin["'\s:]+\*/.test(source));
check("cors.ts does not enable credentials", !source.includes("Allow-Credentials:"));

console.log("\n=== 7. Server wiring: every browser-readable path carries the headers ===");

const server = await import("node:fs").then((fs) =>
  fs.readFileSync(new URL("../src/web/server.ts", import.meta.url), "utf8")
);
check("the JSON helper attaches CORS centrally", /function json\([\s\S]{0,220}corsHeaders\(/.test(server));
check("the streaming writeHead attaches CORS", /application\/x-ndjson[\s\S]{0,200}corsHeaders\(/.test(server));
check("no JSON response bypasses the helper", !/json\(res,\s/.test(server));
check("preflight is handled", /req\.method === "OPTIONS"/.test(server));
check(
  "preflight is resolved before the pipeline is reachable",
  server.indexOf('req.method === "OPTIONS"') < server.indexOf("return handleSnapshot"),
  "preflight must be ahead of the handler"
);
check("a denied origin is refused in the router", /cors\.kind === "denied"/.test(server));
check("public failure wording is unchanged", server.includes("UNAVAILABLE_MESSAGE"));

// CORS is an infrastructure boundary, not a product concept. No string the
// visitor can be shown may mention it — checked against the actual `message:`
// values rather than the file as a whole, so import paths and identifiers do
// not produce a false positive.
const visitorMessages = [...server.matchAll(/message:\s*(?:"([^"]*)"|`([^`]*)`)/g)].map((m) => m[1] ?? m[2] ?? "");
check("visitor messages were found to inspect", visitorMessages.length >= 5, `${visitorMessages.length}`);
const leaky = visitorMessages.filter((m) => /\bcors\b|cross-origin|\borigin\b|allowlist|preflight/i.test(m));
check("no visitor message mentions the origin boundary", leaky.length === 0, leaky.join(" | "));

console.log(`\n${failed === 0 ? "ALL PASSED" : `${failed} CHECK(S) FAILED`}`);
process.exit(failed === 0 ? 0 : 1);
