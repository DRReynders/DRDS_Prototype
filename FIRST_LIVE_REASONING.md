# First Live Reasoning Test

The exact sequence for the prototype's first real reasoning run. The only
remaining blocker is provider configuration — everything below it is built and
verified structurally (mock end-to-end, unit-checked budget guard, per-stage
observability).

## 1. Where to add the API key

- [ ] Copy `.env.example` to `.env` in the project root (`drds-prototype/`)
- [ ] Set `ANTHROPIC_API_KEY=<real key>` in `.env` — nowhere else, never in code
- [ ] Confirm `.env` is untracked (it is gitignored)

## 2. How to choose models

Model routing is per task tier, in `.env` — Contracts never name models:

- [ ] `DRDS_MODEL_FAST` — extraction/classification (CIP identification,
      evidence text checks). Leave empty for the default: `claude-haiku-4-5-20251001`
- [ ] `DRDS_MODEL_REASONING` — Goal Model, CDER reasoning, Snapshot copywriting.
      Leave empty for the default: `claude-sonnet-5`
- [ ] `DRDS_MODEL` — optional single override forcing BOTH tiers to one model
      (useful for an all-strong-model comparison run later; leave empty for the first test)

## 3. How to set the max run cost

- [ ] `MAX_RUN_COST_USD=0.50` (already the example default) — a soft per-run
      ceiling checked before each LLM call; when reached, the run stops
      gracefully at stage `budget` with a clear message and a written run log.
      Empty or `0` disables the guard. Expected first-run cost is well under
      $0.10 at default models, so $0.50 leaves honest headroom without risk.

## 4. Pre-flight (no cost)

- [ ] `npm run smoke` — non-LLM stages pass against the real southwood.co.za
- [ ] `npx tsx test/budget-check.ts` — pricing table + budget guard unit checks pass
- [ ] Confirm `DRDS_LLM_PROVIDER` is `anthropic` (or unset); no `[MOCK]` text
      should appear anywhere after this point

## 5. How to run one URL

```
npm run pipeline -- https://www.southwood.co.za
```

- [ ] Watch per-stage observability: every Contract reports started → completed
      with duration and confidence
- [ ] Expected: 4 LLM calls minimum, up to 6 if Confidence Escalation triggers
      (CIP, Goal Model, Evidence-textual, CDER [, escalation check, re-reason])
- [ ] The CLI prints the usage summary at the end: calls, tokens in/out,
      estimated cost, per-model breakdown

## 6. Where to inspect token/cost logs

- [ ] `runs/<timestamp>_southwood.co.za.json` — the flat run log. Key blocks:
  - `llmUsage.calls[]` — per call: stage, prompt name, provider, model, input/
    output/total tokens, estimated cost (marked as estimated), duration, status
  - `llmUsage.totals` — run totals: calls, failed calls, tokens, estimated cost
  - `llmUsage.modelBreakdown` — per-model calls/tokens/cost
  - `stages[]` — per-Contract started/completed/failed, duration, confidence
  - `escalationTrace` — whether the single escalation attempt ran, and its outcome

## 7. What output to bring back for review

Bring the complete run-log JSON file, plus these five first-line checks:

- [ ] **Is the business correctly identified?** CIP must say Southwood Financial
      Planning / Financial Advisory / Cape Town. Wrong business = hard stop
- [ ] The five Snapshot cards + confidence line, as rendered
- [ ] Hypothesis Confidence (paper result was Medium — does live output overclaim?)
- [ ] The escalation trace (at most one attempt, honestly recorded)
- [ ] The usage totals (tokens + estimated cost) for budget calibration

## 8. After review — full regression

- [ ] `npm run regression` (Southwood 001, Zeelie 002, GKC 003, sequentially)
- [ ] Compare each against its paper Validation Exercise: same business, same
      goal shape, same constraint territory (001: credibility real but socially
      invisible · 002: trust signals real but fragmented · 003: inconsistent
      contact information), no overclaimed confidence, three genuinely distinct
      Snapshots
- [ ] Record every divergence explicitly — including the two expected structural
      ones: no cross-source identity conflicts (no search API) and GBP items
      Not Assessed for a structural reason
- [ ] Decision gate: classify divergences (run-mode limitation vs. reasoning
      failure) before any public demo or email work

**Do not run live API calls until the key and budget settings are confirmed in place.**
