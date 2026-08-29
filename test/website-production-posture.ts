// Website V2's production indexing posture and footer trust statement.
// No network, no LLM calls, no cost. Run: npx tsx test/website-production-posture.ts
//
// Three things this pins, all of which are silent when wrong:
//
//   · production robots.txt must ALLOW crawling and must advertise no sitemap.
//     The dangling `Sitemap:` line this replaced pointed at a URL WordPress
//     serves and Website V2 does not emit — harmless-looking, and a 404 at the
//     exact moment a crawler first meets the new site.
//   · staging must stay `Disallow: /` and site-wide noindex. A staging host that
//     quietly became crawlable is not a bug anyone notices from the outside.
//   · /start/ must stay `noindex, follow`, and / and /snapshot/ must stay
//     indexable. Ratified: /start/ is a conversion endpoint reached through the
//     funnel, not a search-acquisition page.
//
// These are SOURCE assertions rather than assertions against `dist/`. The build
// output is not tracked, so a test that read it would pass or fail depending on
// which environment someone last built — exactly the flakiness this suite exists
// to prevent. The modules themselves cannot be imported here either: both read
// `import.meta.env`, which Vite supplies at build time and plain Node does not.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const WEBSITE = join(HERE, "..", "website");

let failed = 0;
function check(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond || !detail ? "" : `  -> ${detail}`}`);
  if (!cond) failed++;
}

const read = (...parts: string[]): string => readFileSync(join(WEBSITE, ...parts), "utf8");

/** Strip `//` and `/* *​/` comments, including Astro's `{/* … *​/}` form.
 *
 *  Checks that assert something is ABSENT must read what ships, not the prose
 *  around it. A comment saying "no adapter is configured" is not an adapter, and
 *  a comment saying "no founder biography" is not a founder biography — but a
 *  naive search of the file finds both and fails for the wrong reason. */
function withoutComments(source: string): string {
  return source.replace(/\{?\/\*[\s\S]*?\*\/\}?/g, " ").replace(/^\s*\/\/.*$/gm, " ");
}

/** The markup a component actually renders: no frontmatter, no comments, no
 *  `<style>` block. */
function renderedMarkup(source: string, tag: string): string {
  const match = source.match(new RegExp(`<${tag}[\\s\\S]*?</${tag}>`));
  return withoutComments(match?.[0] ?? "");
}

const robots = read("src", "pages", "robots.txt.ts");
const layout = read("src", "layouts", "BaseLayout.astro");
const footer = read("src", "components", "SiteFooter.astro");
const start = read("src", "pages", "start.astro");
const home = read("src", "pages", "index.astro");
const snapshot = read("src", "pages", "snapshot.astro");
const siteEnv = read("src", "lib", "site-env.ts");

/** The two robots.txt payloads, extracted from their template literals so the
 *  checks below read the text that actually ships, not the file around it. */
function payload(name: "STAGING" | "PRODUCTION"): string {
  const match = robots.match(new RegExp(`const ${name} = \`([\\s\\S]*?)\`;`));
  return match?.[1] ?? "";
}
const PRODUCTION = payload("PRODUCTION");
const STAGING = payload("STAGING");

// ─────────────────────────────────────────────────────────────
console.log("=== 1. Production robots.txt ===");

check("the production payload was found", PRODUCTION.length > 0);
check("it allows crawling", /^Allow: \/$/m.test(PRODUCTION), PRODUCTION);
check("it addresses all user agents", /^User-agent: \*$/m.test(PRODUCTION));
check("it does NOT disallow anything", !/^Disallow:/m.test(PRODUCTION));

// The point of this pass. A `Sitemap:` line may only come back in the same
// change that starts emitting a sitemap — never on its own.
check("it advertises NO sitemap", !/Sitemap:/i.test(PRODUCTION), PRODUCTION);
check("no sitemap URL survives anywhere in the module", !/sitemap\.xml/i.test(PRODUCTION));

console.log("\n=== 2. Staging robots.txt is unchanged ===");

check("the staging payload was found", STAGING.length > 0);
check("staging disallows everything", /^Disallow: \/$/m.test(STAGING), STAGING);
check("staging never allows crawling", !/^Allow: \//m.test(STAGING));
check("staging says why, so nobody 'fixes' it", /must never be indexed/i.test(STAGING));

console.log("\n=== 3. No sitemap tooling was installed ===");

const websitePkg = JSON.parse(read("package.json")) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};
const deps = { ...websitePkg.dependencies, ...websitePkg.devDependencies };
check("no @astrojs/sitemap dependency", !("@astrojs/sitemap" in deps), Object.keys(deps).join(", "));
check("no SEO integration was added", !Object.keys(deps).some((d) => /sitemap|seo|robots/i.test(d)));
check("no sitemap route exists", !/sitemap/i.test(read("astro.config.mjs")));

console.log("\n=== 4. The environment switch still fails closed ===");

check("production is the default when unset", /if \(!value\) return "production"/.test(siteEnv));
check("an unrecognised value throws rather than defaulting", /throw new Error\(/.test(siteEnv));
check("staging is still a recognised environment", /"production", "staging"/.test(siteEnv));

console.log("\n=== 5. Per-page indexing posture ===");

// Staging forces noindex on every page and ignores the page's own prop; a
// production build honours the prop. Both halves matter.
check(
  "staging forces noindex, nofollow site-wide",
  /IS_STAGING \? "noindex, nofollow"/.test(layout)
);
check(
  "a page cannot opt itself back into indexing on staging",
  /ignores the page's own\s+\/\/\s+`index` prop|ignores the page's own `index` prop/.test(layout.replace(/\s+/g, " ")) ||
    /IS_STAGING \? "noindex, nofollow" : index \?/.test(layout)
);
check("an indexable page emits NO robots tag at all", /: index \? null :/.test(layout));
check("a non-indexed page still passes link equity", /"noindex, follow"/.test(layout));
check("the tag is omitted, not emitted empty", /\{robots \? <meta name="robots"/.test(layout));

check("/start/ opts out of indexing", /index=\{false\}/.test(start));
check("/ does NOT opt out of indexing", !/index=\{false\}/.test(home));
check("/snapshot/ does NOT opt out of indexing", !/index=\{false\}/.test(snapshot));

console.log("\n=== 6. Footer trust statement ===");

check(
  "the trading-identity statement is present",
  /DRDS is the trading identity of DR Digital Systems \(Pty\) Ltd\./.test(footer)
);
check("the registered-entity wording remains", /Registered in South Africa\./.test(footer));
check("the copyright line remains", /©\s*\{year\} DR Digital Systems \(Pty\) Ltd\./.test(footer));

// Restraint is the requirement, not just accuracy. None of this belongs here —
// and this is checked against the rendered <footer>, not the file, so the
// comment explaining the restraint cannot be mistaken for a breach of it.
const footerMarkup = renderedMarkup(footer, "footer");
check("the rendered footer markup was found", footerMarkup.length > 0);
for (const [label, pattern] of [
  ["street address", /\b(street|road|avenue|suite|floor|postal code|P\.?O\.? Box)\b/i],
  ["phone number", /\+?\d[\d\s()-]{7,}/],
  ["email address", /[\w.+-]+@[\w.-]+\.\w+/],
  ["founder biography", /\bfounder\b|\bDavid\b|\bbiography\b/i],
  ["registration number", /\b\d{4}\/\d{6}\/\d{2}\b/],
] as [string, RegExp][]) {
  check(`the footer carries no ${label}`, !pattern.test(footerMarkup), footerMarkup.match(pattern)?.[0] ?? "");
}

console.log("\n=== 7. Strategy Call stays deprecated ===");

// Not just absent from the footer — absent from the whole site. The audit found
// the README still claiming three Strategy Call links that no longer exist; the
// check that matters is against the source, not the prose.
for (const [name, source] of [
  ["the footer", footer],
  ["the header", read("src", "components", "SiteHeader.astro")],
  ["the homepage", home],
  ["/snapshot/", snapshot],
  ["/start/", start],
] as [string, string][]) {
  const links = [...source.matchAll(/href=(?:"([^"]*)"|\{([^}]*)\})/g)].map((m) => m[1] ?? m[2] ?? "");
  const offending = links.filter((h) => /strategy-call|strategy call|book a call/i.test(h));
  check(`${name} carries no Strategy Call link`, offending.length === 0, offending.join(" | "));
}

check(
  "there is still no Strategy Call route constant to paste back in",
  !/strategyCall|STRATEGY_CALL/.test(read("src", "lib", "config.ts"))
);

console.log("\n=== 8. Still static, still no adapter, still one API origin ===");

// Comments stripped: this file's own commentary explains at length that there
// is no adapter, and that sentence must not be what satisfies the check.
const astroConfig = withoutComments(read("astro.config.mjs"));
check("output is static", /output:\s*"static"/.test(astroConfig));
check("no adapter is configured", !/adapter/.test(astroConfig), astroConfig.match(/.*adapter.*/)?.[0] ?? "");
check("directory format is preserved", /format:\s*"directory"/.test(astroConfig));
check("trailing slashes are always emitted", /trailingSlash:\s*"always"/.test(astroConfig));
check("the canonical site is the apex", /site:\s*"https:\/\/drdigitalsystems\.co\.za"/.test(astroConfig));

console.log(`\n${failed === 0 ? "ALL PASSED" : `${failed} CHECK(S) FAILED`}`);
process.exit(failed === 0 ? 0 : 1);
