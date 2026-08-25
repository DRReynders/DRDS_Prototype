# DRDS Website V2 — Astro static-first foundation

Phase 1 foundation only. Not launched, not deployed, not cut over. The existing
WordPress site at `drdigitalsystems.co.za` remains live and untouched.

## What this is

The approved Website V2 topology:

```
Astro static site  →  /snapshot/ page  →  browser calls the Railway Snapshot API
                                          (separate service, separate deploy)
```

- **Static output only.** No adapter, no SSR, no Node runtime at launch.
- **No reverse proxy.** The browser talks to the Snapshot backend directly.
- **Backend failure cannot take the site down.** The marketing pages are plain
  HTML; only `/snapshot/` needs the API, and it degrades to an honest message.
- **No database, no CMS, no auth, no client framework.**

## Isolation from the backend

This project is deliberately self-contained under `website/`. It has its own
`package.json`, lockfile and `node_modules`. The repository root — which is what
Railway builds and deploys as the Snapshot service — declares **no npm
workspaces**, so nothing here is discovered, installed or built by the backend's
deploy. Root `package.json`, root lockfile and `tsconfig.json` are untouched.

Do not introduce a workspace/monorepo setup to accommodate this site.

## Setup

```
cd website
npm install
cp .env.example .env      # then set PUBLIC_SNAPSHOT_API_ORIGIN
```

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Local dev server. Falls back to `http://localhost:3000` for the API with a warning if `.env` is absent. |
| `npm run build` | Static build to `dist/`. **Fails** if `PUBLIC_SNAPSHOT_API_ORIGIN` is missing or invalid. |
| `npm run preview` | Serve the built output locally. |
| `npm run check` | Astro + TypeScript diagnostics. |

## Configuration

One environment value, and it is not a secret:

```
PUBLIC_SNAPSHOT_API_ORIGIN=https://drdsprototype-production.up.railway.app
```

Astro inlines every `PUBLIC_`-prefixed value into the built JavaScript, so it is
visible to every visitor. **Nothing secret may ever be added to `.env.example`.**
API keys belong in the Snapshot backend's own environment.

The value is read in exactly one place — `src/lib/config.ts` — so pointing the
site at a staging backend is one variable, not a search-and-replace.

## Routes

| Route | Output | Status |
|---|---|---|
| `/` | `dist/index.html` | Shell. Placeholder copy. |
| `/snapshot/` | `dist/snapshot/index.html` | Full state structure. Calls the live API. |
| `/start/` | `dist/start/index.html` | Form structure. **Submits nowhere.** `noindex`. |

`build.format: "directory"` plus `trailingSlash: "always"` means conventional
static hosting serves these as directory URLs with no rewrite rules.

The live WordPress **Strategy Call** route is not replaced or redirected by this
site. It stays operational and linked until `/start/` genuinely works.

## Known blocker: CORS

The Snapshot backend currently sends **no CORS headers** and does not handle
`OPTIONS`. Verified against production:

```
OPTIONS /api/snapshot   →  404, no Access-Control-Allow-Origin
POST    /api/snapshot   →  400, no Access-Control-Allow-Origin
```

So a browser on any origin other than the backend's own will refuse the request,
and `/snapshot/` will show the honest "temporarily unavailable" state. **A small,
bounded backend patch is required** before this page can function — see the
Phase 1 report. That patch is deliberately not part of this scaffold.

## JavaScript

One island, on `/snapshot/` only. It is a form handler, not a framework: the page
is fully rendered HTML before it runs and every state container already exists in
the document. It earns its place because the Snapshot is a 1–2 minute streamed
job and the approved architecture has no server runtime to proxy that stream.

`/start/` has a small script whose only job is to *prevent* submission and say so.

`/` ships no JavaScript at all.

## Analytics

None installed. `src/lib/analytics-events.ts` defines the funnel's event
vocabulary and a deliberately inert `track()`. Nothing is transmitted anywhere.
The must-never-capture list in that file is the contract — read it before wiring
any vendor in.

## Design

Tokens in `src/styles/tokens.css` are the foundation for a later design pass, not
the pass itself. Note `--gold` (text on light) versus `--gold-fill` (fills, and
text on navy): brand gold fails contrast as text on cream, which was a real fix
on the live site and is inherited here deliberately.
