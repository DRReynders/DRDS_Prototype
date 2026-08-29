# DRDS Website V2 — Astro static-first foundation

**Status.** Both operating flows — the public Growth Snapshot and the Growth
Report enquiry — are live-verified against production. The site is deployed to
the private staging host `https://v2.drdigitalsystems.co.za` (password-protected,
`noindex`, `Disallow: /`).

**Production cutover has NOT happened.** The existing WordPress site at
`drdigitalsystems.co.za` remains live and untouched, and the apex is not yet an
allowed browser origin on the Snapshot API — see
[Browser origin boundary (CORS)](#browser-origin-boundary-cors) below, which is a
hard prerequisite, not a formality. The host configuration for the eventual
cutover is tracked at `deployment/website-production/`.

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
| `robots.txt` | `Allow: /`, no `Sitemap:` | `Disallow: /` |

`/start/` is `noindex, follow` in production on purpose, and this is ratified:
it is a conversion endpoint reached through the funnel, not a search-acquisition
page. `follow` rather than `nofollow` so it still passes link equity onward.

Production `robots.txt` advertises **no sitemap**. It used to name
`https://drdigitalsystems.co.za/sitemap.xml` — a URL the WordPress site serves
and this site does not emit, so at cutover that line would have pointed a crawler
at a 404. Three public URLs, one of them `noindex`, all one click from the
homepage, do not justify a sitemap or the integration that would generate one.
If that ever changes, generate the sitemap and restore the line in the same
change; never restore the line alone.

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
| `/snapshot/` | `dist/snapshot/index.html` | **Operational.** Full state structure; calls the live API. Stage 1.2 delivery resilience is live: early `runId`, heartbeat, terminal-result preservation, retry-of-delivery-not-computation, `/api/recover`, disconnect resilience. |
| `/start/` | `dist/start/index.html` | **Operational** Growth Report enquiry. POSTs to `/api/report-enquiry`. `noindex`. |
| `robots.txt` | `dist/robots.txt` | Generated from `PUBLIC_SITE_ENV`. See above. |

`build.format: "directory"` plus `trailingSlash: "always"` means conventional
static hosting serves these as directory URLs with no rewrite rules.

The generic **Strategy Call is deprecated and this site does not link to it
anywhere** — not in the footer, not in the `/snapshot/` `<noscript>` block, not
in the `/snapshot/` failure state, and there is no route constant for it in
`src/lib/config.ts`. `/start/` is operational and owns the Growth Report funnel
end to end. The live WordPress `/strategy-call/` route still exists today; at
cutover it 301s to `/start/` (see `deployment/website-production/.htaccess`).

`test/website-production-posture.ts` asserts that absence against the source of
every page and component, because prose in this file was wrong about it once
already.

## Production cutover

Not done, and not started from this directory. The host configuration for the
apex — the `.htaccess` carrying the canonical `www` → apex and `http` → `https`
redirects and the nine ratified legacy WordPress redirects — is tracked at:

```
deployment/website-production/
```

That directory's README also carries the apex CORS prerequisite and the rollback
doctrine (**archive/move WordPress first; never overwrite or delete the existing
production site as the first operation**). Read it before touching the apex.

The `.htaccess` deliberately does **not** live in `website/public/`: everything
there is copied verbatim into every build, so a staging upload would carry it to
`v2.drdigitalsystems.co.za` and overwrite the cPanel-managed `.htaccess` that
host relies on for Directory Privacy.

## The Growth Report pilot price

The controlled-pilot price appears on three pages of this site — the homepage
ladder, the `/snapshot/` result handoff, and `/start/`. None of them writes the
number down. All three read `GROWTH_REPORT_PILOT_PRICE` from `src/lib/config.ts`,
which reads `product.json` at the REPOSITORY ROOT — the same file the Snapshot
backend reads when it renders the Growth Snapshot email.

That is four public surfaces and one literal, which is the point: a visitor
quoted one number here and a different one in their email has been given a reason
to trust neither.

`product.json` holds data and nothing else. Vite inlines it whole into the
browser bundle, so anything written inside it — including a comment key — is
shipped to every visitor. Nothing secret may go in it, and the reasoning lives in
this README and in `src/product.ts` on the backend side.

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

The backend's explicit-origin CORS boundary (`src/web/cors.ts`) is **deployed and
live**. Exact origins only. No wildcard, no subdomain matching, and an unset
value allows no browser origin at all — it fails closed. Requests with no
`Origin` header (CLI, direct API inspection) are unaffected and need no entry.

Verified live by preflight on 2026-08-29, two origins are allowed today:

```
https://drdsprototype-production.up.railway.app
https://v2.drdigitalsystems.co.za
```

### ⚠️ The apex is NOT yet allowed — hard cutover prerequisite

`https://drdigitalsystems.co.za` currently receives **403** on preflight. Deploy
this site to the apex before `SNAPSHOT_ALLOWED_ORIGINS` is updated and the Growth
Snapshot and the Growth Report enquiry both fail on every attempt — invisibly, in
a Railway environment variable rather than in anything here. Ratified target set:

```
SNAPSHOT_ALLOWED_ORIGINS=https://drdsprototype-production.up.railway.app,https://v2.drdigitalsystems.co.za,https://drdigitalsystems.co.za
```

`https://www.drdigitalsystems.co.za` is deliberately excluded: `www` 301s to the
apex before any JavaScript executes, so it never needs to be an API origin, and
adding it would sanction a second canonical frontend origin. Full detail and the
zero-cost verification command are in `deployment/website-production/README.md`.

For local development the value is the dev server's own origin:

```
SNAPSHOT_ALLOWED_ORIGINS=http://localhost:4321        # local Astro dev
```

To run the two locally: start the backend with `SNAPSHOT_ALLOWED_ORIGINS`
including `http://localhost:4321`, set `PUBLIC_SNAPSHOT_API_ORIGIN` here to
`http://localhost:3000`, then `npm run dev`.

## JavaScript

One island, on `/snapshot/` only. It is a form handler, not a framework: the page
is fully rendered HTML before it runs and every state container already exists in
the document. It earns its place because the Snapshot is a 1–2 minute streamed
job and the approved architecture has no server runtime to proxy that stream.

`/start/` has a second, smaller script. It is operational: it validates the five
fields, POSTs the enquiry, guards against a double submit, and replaces the form
with the outcome. The submit button ships `disabled` and that script is what
enables it, so a visitor without JavaScript is told the form cannot send rather
than being given a control that silently does nothing.

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
