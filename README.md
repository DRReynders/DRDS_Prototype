# DRDS Public Prototype — Reasoning Pipeline

First code implementation of the DRDS canonical pipeline (Contracts V0.2, frozen).
Build Order step 1–2: the pipeline alone, CLI-runnable, no web interface, no email,
no database.

## Setup

```
npm install
copy .env.example .env      # then add your real ANTHROPIC_API_KEY to .env
```

The key is required before any full pipeline run — Contracts 1, 2, 4 and 5 make
real LLM calls. Never commit `.env`.

The LLM layer is provider-neutral: contracts depend on `src/llm/client.ts` +
`src/llm/provider.ts` only; vendor SDKs live in `src/llm/providers/`. Select a
provider with `DRDS_LLM_PROVIDER` (`anthropic` default, `mock` for structural
testing without API access — mock output is always marked `[MOCK]` and is never a
real analysis). Adding a future provider = one new file in `src/llm/providers/`
implementing `LlmProvider`, plus a case in `getProvider()`.

## Run

```
npm run pipeline -- https://example-business.co.za   # one business, full pipeline
npm run regression                                    # the three Sprint 1A businesses
npm run smoke                                         # non-LLM stages only, no key needed
```

Each run writes one flat JSON file to `runs/` containing every canonical object
(BusinessInput, CIP, GoalModel, EvidencePackage, ReasoningResult, GrowthSnapshot)
plus the Confidence Escalation trace. The log is for direct file inspection — there
is deliberately no viewer, dashboard, or database.

## Structure

| Path | What it is |
|---|---|
| `src/contracts/` | One module per Contract (0–5), faithful to Contracts V0.2 |
| `src/evidence/checks.ts` | The fixed 17-item evidence subset — hardcoded by design |
| `src/projection/public-snapshot.ts` | The PUBLIC Growth Snapshot — deterministic, built from Contracts 0–3 only |
| `prompts/*.txt` | Editable prompt text (Prompt Library v1 + two new automation prompts) |
| `src/pipeline.ts` | Orchestrator — the seam a future web layer calls |
| `runs/` | One JSON log per run |

## Web prototype

`npm start` (or `npm run web`) serves the public prototype: CTA form → Waiting
Room (real pipeline milestones streamed as NDJSON — no artificial timers) →
public Growth Snapshot → optional "Email me this Growth Snapshot" (persistence,
never a gate). Routes: `GET /`, `POST /api/snapshot` (streams milestones +
result), `POST /api/email` (sends via Resend; honest not-configured state
without a key), `POST /api/report-enquiry` (see below).

### The Growth Report enquiry route

`POST /api/report-enquiry` is the operational entry point for a Growth Report,
called by Website V2's `/start/` page. It accepts five fields — name, email,
business name, business website, and one optional context answer — validates
them, and sends **one internal email to DRDS**.

It is structurally incapable of the expensive things: `runPipeline` is never
called from it, no `llm` module is reachable on its path, it reads no run log
(so no `publicSnapshot`, `reasoningResult` or `growthSnapshot` is in scope), and
it consults no budget and records no spend. It has its own rate-limit bucket, so
enquiry traffic can never consume a visitor's paid Snapshot allowance.

There is no database, no CRM and no lead store: the email IS the record, so a
delivery failure is reported to the visitor as a failure rather than thanked for.
Set `DRDS_REPORT_ENQUIRY_TO` — it has no default, and an unset value makes the
route refuse rather than fall back to an unrelated recipient.

### The public observation boundary

> The Growth Snapshot may state what is observably true.
> Only the Growth Report may state what matters most.

The free product returns a **`PublicSnapshot`** (`src/projection/public-snapshot.ts`):
what we can see, why we think it, what is working, what public evidence could
not settle, evidence confidence, and a receipt of the pages actually read. It
is built from Contracts 0–3 only, deterministically, with no model call — the
builder's input type cannot reach a `ReasoningResult`, so no constraint exists
for it to publish.

Contracts 4 and 5 still run and still write to the run log. `ReasoningResult`
(with `primaryConstraint`, `secondaryConstraints`, `hypothesisConfidence`,
supporting/contradictory evidence, `constraintSafety`, `reasoningNotes`) and the
internal `GrowthSnapshot` remain the Growth Report's raw material — internal,
never published. `tools/assemble-report.ts` reads them unchanged.

The wire payload carries `publicSnapshot` and nothing else; judgement fields are
absent from it rather than hidden by the UI. `test/public-snapshot-boundary.ts`
and `test/public-projection-replay.ts` enforce that offline, at no cost.

Public-exposure guards: SSRF protection (private/local targets refused),
per-IP rate limit (`RATE_LIMIT_RUNS_PER_HOUR`), per-run cost cap
(`MAX_RUN_COST_USD`), daily cost cap (`MAX_DAILY_COST_USD`, flat file per day
in `runs/`), one run at a time (503 otherwise).

## Deployment (recommended: Render or Railway)

Runs take 1–2 minutes and stream — use an always-on Node host, NOT serverless
functions with short timeouts.

1. Push this folder to a Git repo. Create a Render "Web Service" (or Railway
   service): build `npm install`, start `npm start`, Node 22+.
2. Set the environment variables from `.env.example` in the host's dashboard
   (never commit `.env`).
3. Verify the sending domain in Resend and set `RESEND_API_KEY` / `EMAIL_FROM`.
4. Point `audit.drdigitalsystems.co.za` (CNAME) at the service; link the
   homepage Growth Audit CTA to it.
5. Note: `runs/` is ephemeral on most hosts — attach a small persistent disk
   (Render: 1GB disk mounted at `runs/`) so run logs survive restarts.

## Known, deliberate limitations of this run mode

- **Direct fetch only, no search API.** Identification (Contract 1) sees only the
  business's own site — no directories, social platforms, or registries, which the
  paper exercises used. Cross-source Identity Conflicts are mostly invisible.
- **Google Business Profile checks (E-VIS-018/037/020) are always Not Assessed** —
  structurally unreachable without a search/places API.
- **Confidence Escalation is hard-capped at one attempt** (a code branch, not a loop),
  and can only fetch a page already discovered on the business's own site.
- Sites that block automated fetching will produce thin evidence packages — reported
  honestly as Not Assessed, never guessed around.
- **No JavaScript is executed.** The fetcher reads the HTML the server sends, not the
  page a visitor sees. Animated counters, lazy-loaded images and galleries, carousels,
  and content inside tabs or accordions all read as missing, empty, or zero. Two internal
  rehearsal runs produced confident, specific, *false* findings this way — not merely thin
  evidence, which is a different and worse failure. The Phase 1 safety patch mitigates it:
  pages are scanned for dynamic-content markers, and an absence-or-zero finding on such a
  page is recorded as `Indeterminate — requires rendered verification` rather than a
  failure, with the Primary Constraint blocked from resting mainly on such evidence.
  **Mitigation is not detection: only a rendered check confirms what a visitor sees.**
