// The tracked production host configuration for drdigitalsystems.co.za.
// No network, no LLM calls, no cost. Run: npx tsx test/production-host-config.ts
//
// `deployment/website-production/.htaccess` is the only part of Website V2 that
// no build produces and no test would otherwise touch. It is also the part that
// fails silently: a missing canonical rule does not break a page, it quietly
// serves the site from a second origin whose API calls are all refused, and a
// missing legacy redirect does not error, it just 404s a URL someone linked to.
//
// So this suite pins the ruleset itself. It is a STATIC assertion of file
// content, deliberately — exercising real redirects would mean standing up an
// Apache or LiteSpeed environment, and installing a server to test nine
// redirects is more machinery than the thing being tested. What matters is that
// the rules are present, correctly ordered, and that the things that must NOT
// be in this file have not crept back in.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const HTACCESS_PATH = join(ROOT, "deployment", "website-production", ".htaccess");

let failed = 0;
function check(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond || !detail ? "" : `  -> ${detail}`}`);
  if (!cond) failed++;
}

const raw = readFileSync(HTACCESS_PATH, "utf8");

/** Directive lines only — comments stripped, so a rule that exists solely as
 *  prose in a comment can never satisfy a check below. */
const rules = raw
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line.length > 0 && !line.startsWith("#"));
const directives = rules.join("\n");

const APEX = "https://drdigitalsystems.co.za";

// ─────────────────────────────────────────────────────────────
console.log("=== 1. The file exists and is directives, not just documentation ===");

check("production .htaccess is tracked at the canonical path", raw.length > 0);
check("it contains real directives, not only comments", rules.length >= 12, `${rules.length} directive lines`);
check("comments outnumber nothing — the file explains itself", raw.includes("#"));

console.log("\n=== 2. Directory listing is refused ===");

check("Options -Indexes is present", /^Options\s+-Indexes$/m.test(directives));
check("a directory index is named explicitly", /^DirectoryIndex\s+index\.html$/m.test(directives));

console.log("\n=== 3. Canonical origin: www -> apex, http -> https ===");

check("mod_rewrite is enabled", /^\s*RewriteEngine\s+On$/m.test(directives));
check("HTTPS is enforced explicitly, not inherited", /RewriteCond\s+%\{HTTPS\}\s+!=on/.test(directives));
check("the www host is matched", /RewriteCond\s+%\{HTTP_HOST\}\s+\^www\\\./.test(directives));
check(
  "www and https are ONE rule with [OR], so a doubly-wrong request costs one hop",
  /RewriteCond\s+%\{HTTPS\}\s+!=on\s+\[OR\]/.test(directives)
);
check(
  "the canonical rule redirects to the apex preserving the path",
  new RegExp(`RewriteRule\\s+\\^\\s+${APEX.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}%\\{REQUEST_URI\\}`).test(directives)
);
check("the canonical rule is a permanent redirect", /%\{REQUEST_URI\}\s+\[R=301,L\]/.test(directives));

// www must never become a second live frontend origin: the API allowlist is
// exact-origin, so a page served from www would have every call refused.
check(
  "www is never rewritten to serve content in place",
  !/RewriteRule[^\n]*www\.drdigitalsystems\.co\.za/.test(directives)
);

console.log("\n=== 4. Every approved legacy redirect is present ===");

const LEGACY: [from: string, to: string][] = [
  ["growth-audit", "/snapshot/"],
  ["strategy-call", "/start/"],
  ["services", "/"],
  ["method", "/"],
  ["framework", "/"],
  ["about", "/"],
  ["case-studies", "/"],
  ["case-studies-coming-q3-2026", "/"],
  ["category/announcements", "/"],
];

for (const [from, to] of LEGACY) {
  const pattern = new RegExp(
    `^RewriteRule\\s+\\^${from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/\\?\\$\\s+` +
      `${(APEX + to).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+\\[R=301,L\\]$`,
    "m"
  );
  check(`/${from}/ -> ${to} as a 301`, pattern.test(directives));
}

check("all nine legacy redirects are accounted for", LEGACY.length === 9);

// Every legacy rule targets an ABSOLUTE apex https URL. That is what keeps the
// worst case at one hop: an off-canonical legacy request lands on its final
// destination directly instead of being canonicalised and redirected again.
const legacyRuleLines = rules.filter((l) => /^RewriteRule\s+\^(?!\s)/.test(l) && !/%\{REQUEST_URI\}/.test(l));
check("legacy rules were found to inspect", legacyRuleLines.length === 9, `${legacyRuleLines.length}`);
check(
  "every legacy target is an absolute canonical apex URL",
  legacyRuleLines.every((l) => l.includes(` ${APEX}/`)),
  legacyRuleLines.filter((l) => !l.includes(` ${APEX}/`)).join(" | ")
);
check("every legacy rule is a 301, never a 302", legacyRuleLines.every((l) => l.includes("[R=301,L]")));

console.log("\n=== 5. Ordering: legacy redirects precede origin canonicalisation ===");

const firstLegacyIndex = rules.findIndex((l) => l.includes("^growth-audit"));
const canonicalIndex = rules.findIndex((l) => l.includes("%{REQUEST_URI}"));
check("both rule groups are present", firstLegacyIndex >= 0 && canonicalIndex >= 0);
check(
  "legacy redirects come first, so a www+http legacy URL resolves in one hop",
  firstLegacyIndex < canonicalIndex,
  `legacy@${firstLegacyIndex} canonical@${canonicalIndex}`
);

console.log("\n=== 6. No redirect can loop ===");

// A loop needs a rule whose target is also a rule's source. Every legacy target
// is /, /snapshot/ or /start/; none of those is a legacy source, and all are
// already canonical, so the canonical rule cannot fire on them either.
const legacySources = LEGACY.map(([from]) => `/${from}/`);
const legacyTargets = [...new Set(LEGACY.map(([, to]) => to))];
check(
  "no legacy target is itself a legacy source",
  legacyTargets.every((t) => !legacySources.includes(t)),
  legacyTargets.filter((t) => legacySources.includes(t)).join(" | ")
);
check(
  "every legacy target is an apex https URL the canonical rule ignores",
  legacyTargets.every((t) => (APEX + t).startsWith("https://drdigitalsystems.co.za"))
);

console.log("\n=== 7. What must NOT be in this file ===");

// The static site needs none of this, and each one is a behaviour someone has
// to debug later. A WordPress block in particular would be inherited by accident
// if the old .htaccess were edited instead of replaced.
const FORBIDDEN: [label: string, pattern: RegExp][] = [
  ["WordPress rewrite block", /BEGIN WordPress|index\.php|wp-content|wp-includes|wp-admin/i],
  ["PHP handling", /AddHandler|php_value|php_flag|application\/x-httpd-php|SetHandler/i],
  ["reverse proxy", /ProxyPass|RewriteRule[^\n]*\[P[,\]]|mod_proxy/i],
  ["Snapshot or API rewrite", /\/api\/|railway\.app/i],
  ["caching or performance directives", /ExpiresBy|ExpiresActive|mod_deflate|mod_gzip|Cache-Control|Header\s+set/i],
  ["SSL or certificate directive", /SSLEngine|SSLCertificate/i],
  ["directory listing being switched back on", /Options\s+\+Indexes/i],
];

for (const [label, pattern] of FORBIDDEN) {
  check(`no ${label}`, !pattern.test(directives), directives.match(pattern)?.[0] ?? "");
}

// WordPress plumbing must disappear rather than be redirected: redirecting it
// would be pretending it moved somewhere.
for (const plumbing of ["wp-login", "xmlrpc", "wp-json", "author/", "feed/"]) {
  check(`no redirect is created for /${plumbing}`, !directives.includes(plumbing));
}

console.log("\n=== 8. The apex CORS prerequisite is documented where it cannot be missed ===");

const deployReadme = readFileSync(join(ROOT, "deployment", "website-production", "README.md"), "utf8");
check("SNAPSHOT_ALLOWED_ORIGINS is named", deployReadme.includes("SNAPSHOT_ALLOWED_ORIGINS"));
check("the apex is listed as the origin to add", deployReadme.includes(APEX));
check("the staging origin is retained in the target set", deployReadme.includes("https://v2.drdigitalsystems.co.za"));
check(
  "the Railway origin is retained in the target set",
  deployReadme.includes("https://drdsprototype-production.up.railway.app")
);
check(
  "www is explicitly excluded from the allowlist",
  /deliberately\s+\*\*excluded\*\*|excluded/i.test(deployReadme) &&
    deployReadme.includes("https://www.drdigitalsystems.co.za")
);
check("the rollback doctrine is stated", /Archive\/move WordPress first/i.test(deployReadme));
check(
  "the doctrine forbids overwrite-first",
  /Never overwrite or delete the existing\s+> ?production site as the first operation/i.test(
    deployReadme.replace(/\r?\n/g, " ").replace(/\s+/g, " ")
  ) || /Never overwrite or delete/i.test(deployReadme)
);
check("mail DNS is named as untouchable", /must not alter mail DNS/i.test(deployReadme));

console.log(`\n${failed === 0 ? "ALL PASSED" : `${failed} CHECK(S) FAILED`}`);
process.exit(failed === 0 ? 0 : 1);
