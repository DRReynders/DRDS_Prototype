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

Two environment values, and neither is a secret:

```
PUBLIC_SNAPSHOT_API_ORIGIN=https://drdsprototype-production.up.railway.app
PUBLIC_SITE_ENV=production        # or `staging`; unset means production
```

Astro inlines every `PUBLIC_`-prefixed value into the built JavaScript, so it is
visible to every visitor. **Nothing secret may ever be added to `.env.example`.**
API keys belong in the Snapshot backend's own environment.

Each is read in exactly one place, so pointing the site at a staging backend is
one variable, not a search-and-replace:

- `PUBLIC_SNAPSHOT_API_ORIGIN` → `src/lib/config.ts`
- `PUBLIC_SITE_ENV` → `src/lib/site-env.ts`

They are separate modules on purpose. `config.ts` is imported by
`snapshot-client.ts` and is therefore bundled into the browser; `site-env.ts` is
build-time only and must never be imported from client code, so no
build-environment machinery ships to visitors.

## Build environments and indexing

`PUBLIC_SITE_ENV` exists for one reason: the private staging host must never be
indexed, and the eventual production launch must never inherit that.

| | `production` (or unset) | `staging` |
|---|---|---|
| `/` | indexable | `noindex, nofollow` |
| `/snapshot/` | indexable | `noindex, nofollow` |
| `/start/` | `noindex, follow` | `noindex, nofollow` |
| `robots.txt` | `Allow: /` | `Disallow: /` |

Two mechanisms, both build-time, no JavaScript and no server:

- **`src/layouts/BaseLayout.astro`** makes the decision once for every page. In
  a staging build it forces `noindex, nofollow` and ignores the page's own
  `index` prop, so a page cannot opt itself back into indexing.
- **`src/pages/robots.txt.ts`** generates `robots.txt`. It is a prerendered
  static endpoint, not a `public/` file, because a `public/` file would be
  copied verbatim into both builds and staging would have shipped `Allow: /`.

An unrecognised `PUBLIC_SITE_ENV` **fails the build** (`src/lib/site-env.ts`).
Falling back to "production" on a typo is exactly how a staging host becomes
crawlable.

Staging build:

```
cd website
PUBLIC_SITE_ENV=staging PUBLIC_SNAPSHOT_API_ORIGIN=https://drdsprototype-production.up.railway.app npm run build
```

The build prints the environment it produced, e.g.
`[drds] PUBLIC_SITE_ENV=staging — pages are noindex, nofollow; robots.txt says Disallow: /`.

Indexing controls are separate from, and additional to, the staging host's cPanel
Directory Privacy. Neither replaces the other.

## Routes

| Route | Output | Status |
|---|---|---|
| `/` | `dist/index.html` | Shell. Placeholder copy. |
| `/snapshot/` | `dist/snapshot/index.html` | Full state structure. Calls the live API. |
| `/start/` | `dist/start/index.html` | **Operational** Growth Report enquiry. POSTs to `/api/report-enquiry`. `noindex`. |
| `robots.txt` | `dist/robots.txt` | Generated from `PUBLIC_SITE_ENV`. See above. |

`build.format: "directory"` plus `trailingSlash: "always"` means conventional
static hosting serves these as directory URLs with no rewrite rules.

The live WordPress **Strategy Call** route is not replaced or redirected by this
site, but it is no longer part of the Growth Report flow: `/start/` is
operational and owns that funnel end to end. Strategy Call remains linked in the
footer, in the `/snapshot/` `<noscript>` block and in the `/snapshot/` failure
state — three places where the enquiry form genuinely cannot serve, because
either JavaScript is unavailable or the visitor needs a person rather than a
paid-Report enquiry form.

## The Growth Report enquiry (`/start/`)

`/start/` posts five fields — name, email, business name, business website and
one optional context answer — to `POST /api/report-enquiry` on the same API
origin the Snapshot uses (`PUBLIC_SNAPSHOT_API_ORIGIN`). There is no second
origin setting, because there is no second deployment.

The backend validates the submission and sends **one internal email to DRDS**.
There is no database, no CRM and no mailing list: that email is the whole record
of the enquiry, which is why a delivery failure is reported to the visitor as a
failure rather than thanked for. Nothing is charged, no Growth Report is started
and no automatic reply is sent to the enquirer.

The backend needs one environment variable set before this route can work:

```
DRDS_REPORT_ENQUIRY_TO=audit@drdigitalsystems.co.za   # where enquiries land
```

It has no default. An unset value makes the route refuse to send and answer
`503` rather than silently routing a prospect's details to whichever address
happened to be configured for something else.

## Browser origin boundary (CORS)

The backend now has an explicit-origin CORS boundary (`src/web/cors.ts`), added
in Website V2 Phase 2 **on this branch**. It is not yet deployed: production
still runs the pre-boundary build, so `/snapshot/` pointed at production will
still show the honest "temporarily unavailable" state until that ships.

For the boundary to permit this site, the backend needs its own environment
variable set — see the repository-root `.env.example`:

```
SNAPSHOT_ALLOWED_ORIGINS=http://localhost:4321        # local Astro dev
SNAPSHOT_ALLOWED_ORIGINS=https://drdigitalsystems.co.za   # production site
```

Exact origins only. No wildcard, and an unset value allows no browser origin at
all — it fails closed. Requests with no `Origin` header (CLI, direct API
inspection) are unaffected and need no entry.

To run the two locally: start the backend with `SNAPSHOT_ALLOWED_ORIGINS`
including `http://localhost:4321`, set `PUBLIC_SNAPSHOT_API_ORIGIN` here to
`http://localhost:3000`, then `npm run dev`.

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
