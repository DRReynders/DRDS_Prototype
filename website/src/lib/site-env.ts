// Which environment this build is for. BUILD-TIME ONLY.
//
// *** SERVER-ONLY MODULE. Never import this from client-side code. ***
//
// It lives apart from `config.ts` deliberately. `config.ts` is imported by
// `snapshot-client.ts` and is therefore bundled into the browser, so anything
// added there ships to every visitor. This switch is a property of the BUILD,
// not of the running page, and belongs nowhere near the client bundle.
//
// Import it only from `.astro` frontmatter and static endpoints, both of which
// execute at build time and emit nothing to the browser.
//
// It has exactly one job: decide whether the emitted HTML and robots.txt invite
// crawling. No adapter, no SSR, no runtime server.
//
//   production : the eventual public launch build. Indexable.
//   staging    : the private v2.drdigitalsystems.co.za copy. Every page is
//                noindex and robots.txt disallows everything.
//
// Unset means "production", so local development and the existing build are
// unchanged. An UNRECOGNISED value is a hard build failure rather than a silent
// fall back to production: a typo in this variable must never be the reason a
// staging host became crawlable.

const SITE_ENVS = ["production", "staging"] as const;

export type SiteEnv = (typeof SITE_ENVS)[number];

function resolveSiteEnv(): SiteEnv {
  const raw = import.meta.env.PUBLIC_SITE_ENV;
  const value = typeof raw === "string" ? raw.trim().toLowerCase() : "";

  if (!value) return "production";
  if ((SITE_ENVS as readonly string[]).includes(value)) return value as SiteEnv;

  throw new Error(
    `PUBLIC_SITE_ENV is "${raw}", which is not a recognised environment. Use one of: ` +
      `${SITE_ENVS.join(", ")} (or leave it unset, which means "production"). ` +
      `This fails the build on purpose — silently treating a typo as production would ship an indexable staging site.`
  );
}

/** Which environment this build is for. Build-time constant. */
export const SITE_ENV: SiteEnv = resolveSiteEnv();

/** True for the private staging host. Forces site-wide noindex and flips
 *  robots.txt to deny all crawling. Never true in a production build. */
export const IS_STAGING: boolean = SITE_ENV === "staging";
