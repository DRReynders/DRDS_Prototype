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

// Unchanged from the previous static file, so a production build emits exactly
// what it emitted before this staging work existed.
const PRODUCTION = `# DRDS Website V2 — foundation scaffold.
# This file ships with the static build. It is NOT live: the production robots
# policy is still served by the existing WordPress site and is unaffected.
User-agent: *
Allow: /

Sitemap: https://drdigitalsystems.co.za/sitemap.xml
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
