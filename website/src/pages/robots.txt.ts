// robots.txt is GENERATED rather than shipped as a static `public/` file.
//
// Its content is the one thing that must differ between the private staging
// host and the eventual production launch. A file in `public/` is copied
// verbatim into every build, so the staging upload would have carried
// `Allow: /` — password-protected, but still inviting crawling.
//
// This is an Astro static endpoint. Under `output: "static"` it is prerendered
// to `dist/robots.txt` at build time. No adapter, no SSR, no runtime server.
//
// Server-only module: nothing here is bundled into the browser, so this is also
// where the build announces which environment it just produced.
import type { APIRoute } from "astro";
import { IS_STAGING, SITE_ENV } from "../lib/site-env";

// Private staging copy at v2.drdigitalsystems.co.za. Deny everything.
const STAGING = `# DRDS Website V2 — STAGING.
# This host is a private staging copy of the site. It must never be indexed.
User-agent: *
Disallow: /
`;

// The production policy: allow crawling, and say nothing else.
//
// There is deliberately NO `Sitemap:` directive. This file used to advertise
// https://drdigitalsystems.co.za/sitemap.xml, which the WordPress site serves
// today (as a 301 to Rank Math's sitemap index) and which Website V2 does not
// emit at all — so at cutover that line would have pointed a crawler at a 404.
//
// Product Council ratified removing the line rather than generating a sitemap:
// this site has three public URLs, one of them `noindex`, all of them reachable
// in one click from the homepage. A sitemap discovers nothing a crawler would
// miss, and installing an SEO integration to produce one is platform work the
// site has not earned. If the site ever grows past what a crawler can walk
// unaided, generate a real sitemap and restore this line in the same change —
// never restore the line on its own.
const PRODUCTION = `# DRDS Website V2.
User-agent: *
Allow: /
`;

export const GET: APIRoute = () => {
  console.log(
    `[drds] PUBLIC_SITE_ENV=${SITE_ENV} — pages are ${IS_STAGING ? "noindex, nofollow" : "indexable"}; ` +
      `robots.txt says ${IS_STAGING ? "Disallow: /" : "Allow: /"}`
  );

  return new Response(IS_STAGING ? STAGING : PRODUCTION, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};
