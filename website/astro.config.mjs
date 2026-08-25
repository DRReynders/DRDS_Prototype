// @ts-check
import { defineConfig } from "astro/config";

// Website V2 — Astro static-first.
//
// Deliberate posture, per the approved architecture:
//   - `output: "static"` and NO adapter. There is no Node SSR requirement at
//     launch and no reverse-proxy dependency. Every route is a plain HTML file.
//   - `build.format: "directory"` + `trailingSlash: "always"` so the approved
//     routes emit `/snapshot/index.html` and `/start/index.html`. That is what
//     conventional static/cPanel hosting serves as `/snapshot/` and `/start/`
//     without any rewrite rules.
//   - `site` is the intended production canonical host. It is a build-time
//     constant used for canonical URLs only — it changes no DNS and points at
//     nothing new.
//
// The Snapshot API origin is NOT configured here. It is a public environment
// value read through `src/lib/config.ts`, so staging and local builds can talk
// to a different backend without touching this file.
export default defineConfig({
  site: "https://drdigitalsystems.co.za",
  output: "static",
  trailingSlash: "always",
  build: {
    format: "directory",
  },
});
