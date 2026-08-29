# Website V2 — production host configuration

Canonical configuration for serving Website V2 at `https://drdigitalsystems.co.za`.

**Nothing here has been deployed.** The apex still serves WordPress. This
directory exists so that the eventual cutover is a file copy against reviewed
configuration rather than an improvisation at the console.

Contents:

| File | Goes where |
|---|---|
| `.htaccess` | The apex document root, beside the Astro build |

`.htaccess` is tracked here and **not** in `website/public/`. Everything in
`public/` is copied verbatim into every build, so a staging upload would carry
it to `v2.drdigitalsystems.co.za` and overwrite the cPanel-managed `.htaccess`
that host relies on for Directory Privacy. Staging keeps its own; this file is
placed on the apex by hand, once.

## What it does

1. `Options -Indexes` — no directory listing (`/_astro/` has no index file).
2. `DirectoryIndex index.html` — stated explicitly; the previous occupant of
   this document root was PHP.
3. **One canonical origin.** `www` → apex and `http` → `https`, combined into a
   single rule so a request wrong on both counts is corrected in one redirect.
4. **Nine legacy 301s**, listed *before* canonicalisation and targeting absolute
   canonical URLs, so the worst case stays at one hop.

It contains no WordPress rewrite block, no PHP handler, no reverse proxy, no
`/api/` rewrite, and no caching or performance directives.

## Legacy redirect map (ratified)

| From | To |
|---|---|
| `/growth-audit/` | `/snapshot/` |
| `/strategy-call/` | `/start/` |
| `/services/` | `/` |
| `/method/` | `/` |
| `/framework/` | `/` |
| `/about/` | `/` |
| `/case-studies/` | `/` |
| `/case-studies-coming-q3-2026/` | `/` |
| `/category/announcements/` | `/` |

WordPress plumbing — `/wp-admin/`, `/wp-login.php`, `/wp-json/`, `/feed/`,
`/author/…`, `/?s=`, `/xmlrpc.php` — is deliberately **not** redirected. It
disappears with WordPress and 404s honestly.

`test/production-host-config.ts` asserts every one of these rules against this
file. It runs offline and installs nothing.

## ⚠️ Hard prerequisite: the apex is not yet an allowed API origin

Verified by preflight against production on 2026-08-29:

| Origin | `OPTIONS /api/snapshot` |
|---|---|
| `https://drdsprototype-production.up.railway.app` | 204 |
| `https://v2.drdigitalsystems.co.za` | 204 |
| **`https://drdigitalsystems.co.za`** | **403** |
| `https://www.drdigitalsystems.co.za` | 403 |

`SNAPSHOT_ALLOWED_ORIGINS` is exact-origin with no wildcard and no subdomain
matching (`src/web/cors.ts`). **If Website V2 is deployed to the apex before
that variable is updated, the Growth Snapshot and the Growth Report enquiry
both fail on every attempt** — not visibly in the static site, but in a Railway
environment variable.

Ratified target set, to be applied in Railway **before** cutover:

```
SNAPSHOT_ALLOWED_ORIGINS=https://drdsprototype-production.up.railway.app,https://v2.drdigitalsystems.co.za,https://drdigitalsystems.co.za
```

`https://www.drdigitalsystems.co.za` is deliberately **excluded**: the redirect
above guarantees no application JavaScript ever runs on the www host, so www
never needs to be an API origin. Adding it would sanction a second canonical
frontend origin, which the approved architecture rejects.

Changing this variable triggers a Railway redeploy. The daily spend ledger and
run logs are file-based on ephemeral storage, so the redeploy resets the daily
budget counter — do this deliberately and ahead of the cutover window, not
during it.

Cheapest possible verification, costing nothing and starting no run (a preflight
is answered before rate limiting, budget accounting and body parsing):

```bash
curl -si -X OPTIONS https://drdsprototype-production.up.railway.app/api/snapshot -H 'Origin: https://drdigitalsystems.co.za' -H 'Access-Control-Request-Method: POST' | head -1
```

Expect `204` with `Access-Control-Allow-Origin: https://drdigitalsystems.co.za`.

## Rollback doctrine

> **Archive/move WordPress first. Never overwrite or delete the existing
> production site as the first operation.**

The order is always **archive → move → deploy → verify → retain**, never a
destructive overwrite. Before any Website V2 file enters the apex document root,
an **off-server** backup must exist containing:

- the current `public_html` files in full;
- the current `.htaccess`, preserved as its own separate file — it is the single
  highest-value, easiest-to-lose artefact, and it may be the only home of the
  existing `http → https` rule;
- a WordPress database export (without it the archived files cannot be restored
  to a working site);
- `wp-content/uploads`;
- `.well-known/` — required for cPanel AutoSSL renewal, and it must remain
  servable after cutover;
- any cPanel-managed system directories and dotfiles the hosting requires
  (`cgi-bin/` and similar).

Retire WordPress by **renaming** its tree out of the document root, not by
deleting it. Retain both the archive and the renamed tree for at least 30 days
after a clean verification.

**Rollback is file restoration, not DNS manipulation.** The apex, `www`, `v2`
and `mail` all already resolve to the same cPanel host, so the cutover changes
no DNS record at all and recovery is a file move on one server — minutes, with
no propagation delay and no TTL to wait out.

Website cutover must not alter mail DNS. `MX`, SPF, DMARC, and the
`google._domainkey`, `default._domainkey` and `resend._domainkey` records carry
Google Workspace and Resend delivery, including the Growth Report enquiry email
to `audit@drdigitalsystems.co.za`. None of them is touched by a file operation
inside a document root, and none of them should be edited as part of it.
