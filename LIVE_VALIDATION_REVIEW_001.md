# DRDS Live Validation Review 001 — First Live Reasoning Regression

**Status:** Completion record of the first code-based regression against the three
paper-validated businesses (Validation Exercises 001–003). Run mode: direct fetch
only (no search API), Anthropic provider, cost-aware routing (Haiku = extraction,
Sonnet = reasoning), budget guard $0.50/run.

**Runs:** Southwood Financial Planning (2026-07-05, pre-fix), Zeelie Professional
Accountants SA and GKC Attorneys (2026-07-05, post-fix — Supporting Evidence
guard + value-ladder prompt correction applied between Southwood and these two).

---

## 1. Agreement with paper validation

- **Business identification: 3 for 3 correct.** Right business, right Business
  Type (Financial Advisory / Accounting / Legal), right primary location, every
  time. The most severe possible failure mode (wrong business) did not occur.
- **Goal Model: same goal shape on all three.** Trust-based client acquisition
  and retention framings matching the paper inferences, with heavy Growth
  Function overlap (Credibility, Persuasion, Discoverability, Retention
  recurring). Confidence tracked self-descriptiveness, as the paper predicted —
  and ran slightly *more conservative* than paper on all three (Medium/
  Medium-High vs paper's Medium-High/High).
- **Hypothesis Confidence: Medium on all three — exactly matching the paper.**
  No overclaiming anywhere; every Snapshot's confidence line is honest plain
  language disclosing what couldn't be checked.
- **Escalation discipline: intact in all runs.** Each run either attempted
  exactly one escalation or declined with recorded reasoning; the hard cap held
  (Zeelie: precisely one gather, then stop).
- **Zeelie's constraint landed in the paper's territory.** Paper: "trust signals
  real but fragmented." Live: "credibility rests on self-reported credentials
  and unverifiable testimonials." Same underlying diagnosis — trust asserted
  but not independently provable — reshaped by what each run mode could see.
- **No template convergence.** Three genuinely distinct Snapshots citing
  different specific evidence — the paper Sprint's core anti-template result
  reproduced in code.

## 2. Divergences

- **Southwood (biggest divergence): Discoverability vs paper's "credibility
  socially invisible."** Two evidence-driven causes: (a) the live run *found the
  testimonials page the paper missed* (`/client-references`, 8 named
  testimonials — paper recorded "no testimonials found"), which factually
  invalidates the paper's framing for this site; (b) the live run gathered
  title/meta/H1 evidence the paper never collected (H1 missing on all 7 pages).
  Classification: legitimate evidence-driven divergence, not reasoning drift.
- **GKC: on-page discoverability vs paper's "inconsistent contact information."**
  The paper's NAP finding came entirely from cross-source directory conflicts
  (three different addresses), which are structurally invisible to direct-fetch
  mode — intra-site NAP was consistent (Pass). Within reachable evidence, the
  live constraint was the strongest-supported available. Classification:
  run-mode limitation, honestly disclosed in the Snapshot.
- **Identity Conflicts: 0 for 3 live vs 3 for 3 on paper.** All paper conflicts
  (Tokai/Westlake; Nigel/Cape Town; three-way address) were cross-source. As
  predicted before the runs: structural, not a reasoning failure.
- **CIP Identification Confidence ran higher than paper** (High/High/High vs
  High/Medium-High/Medium) — the live runs never see the conflicting sources
  that pulled paper confidence down. Watch item, see §7.
- **Both fetch-blocked paper cases (Zeelie, GKC) fetched cleanly live** — the
  robots/blocking situation from the paper exercises did not recur.
- **E-SCA-001 (retention claim) judged inconsistently between runs:** GKC's
  "long term personal relationships" → Indeterminate (correct per prompt);
  Zeelie → Not Assessed despite similar language existing per the paper. See §7.

## 3. New observations

- **First-ever escalation attempt that returned evaluable evidence.** All three
  paper escalations (and live Southwood's consideration) hit the GBP wall.
  Zeelie's live escalation asked a *different, answerable* question — "are the
  claimed accreditations backed by visible badges/membership numbers?" —
  fetched the contact page, got a genuine **Fail**, strengthened the hypothesis,
  and honestly kept confidence at Medium. The Principle's success path has now
  been exercised, not just its honest-failure path.
- **Escalation declines are producing high-quality recorded reasoning** (GKC:
  "one more peripheral page cannot shift an established 7-page pattern"). The
  audit trail is arguably richer than the paper equivalent.
- **Granularity gain:** live evidence distinguishes "credential stated in text"
  from "credential shown as verifiable badge/number" — a finer distinction than
  the paper's Pass on the same item, and it directly shaped Zeelie's constraint.
- **Systematic tilt to name:** with title/meta/H1 checks in the fixed subset and
  cross-source checks unavailable, 2 of 3 live constraints were on-page-SEO-
  shaped. Not template output (different evidence, different specifics), but
  the paper Cross-Review's warning — findings reflect what the tooling can see —
  now has a live counterpart worth carrying forward.

## 4. Token usage

| Business | LLM calls | Input tokens | Output tokens | Total |
|---|---|---|---|---|
| Southwood | 6 | 22,067 | 6,537 | 28,604 |
| Zeelie | 8 (incl. 1 escalation gather + re-reason) | 40,994 | 9,241 | 50,235 |
| GKC | 6 | 21,363 | 7,798 | 29,161 |
| **Total** | **20** | **84,424** | **23,576** | **108,000** |

Failed calls: 0 of 20. Model split held as configured (Haiku: CIP + evidence
classification; Sonnet: Goal Model, CDER, escalation check, Snapshot).

## 5. Cost per business (estimated, price-table basis)

- Southwood: **$0.1223**
- Zeelie: **$0.1918** (escalation adds ~$0.05–0.07 when it fires)
- GKC: **$0.1418**

## 6. Total cost

**$0.4559** for the full three-business regression. Comfortably inside the
$0.50 *per-run* guard; a public Snapshot costs roughly **$0.12–0.20 per visitor**
at current models.

## 7. Prompt improvements identified

Applied during this regression (both verified working in Zeelie/GKC):
1. `cder-reasoning` v1.1 — neither evidence list may cite Not Assessed items.
2. `snapshot-copywriting` v1.1 — value-ladder rule; Card 5 now correctly points
   to the Growth Report, never the Blueprint.

Identified, not yet applied:
3. `evidence-textual`: clarify that a publicly visible retention/relationship
   claim = **Indeterminate** (claim observed, unverifiable), reserving Not
   Assessed for "no relevant content seen" — fixes the Zeelie/GKC inconsistency.
4. `cip-identification`: consider capping single-source identification at
   Medium-High, or requiring an explicit "single-source, no independent
   corroboration" qualifier on High — live CIP confidence runs hot vs paper
   because conflicting sources are invisible in this run mode.

## 8. Code improvements identified

1. **Duplicate page fetches (GKC):** `http://` and `https://` variants of the
   same three pages were fetched and sent to the LLM twice — normalise scheme
   and host before dedupe in `site.ts`. Wasted tokens, no correctness impact.
2. Persist `robotsBlockedUrls`/`robotsDisallows` into the run log (currently
   only in-memory) so blocked-crawl runs are auditable after the fact.
3. `E-VIS-041` page-type patterns miss pages like `/client-references`
   (Southwood's testimonials page) — add `reference|client` to the
   testimonials/reviews pattern.

## 9. Reasoning quality vs the paper Sprint

**Consistent, with two genuine improvements and one watch item.** Consistent:
same constraint territory wherever evidence overlapped, identical final
confidence (Medium ×3), intact escalation discipline, three distinct
non-templated Snapshots. Improved: evidence-gathering caught a page the human
paper run missed (Southwood testimonials), and evidence granularity is finer
(badge-vs-text). Watch: CIP confidence calibration in single-source mode (§7.4),
and the on-page-SEO tilt (§3) — neither is a regression, both are properties of
the run mode to keep visible.

## 10. Recommendation

**Ready to move from engineering validation to the first true public prototype —
with three conditions carried forward, not blockers:**

1. Apply the two remaining prompt calibrations (§7.3–7.4) and the dedupe fix
   (§8.1) — small, cheap, and they tighten honesty and cost before strangers
   see output.
2. Keep the budget guard on and review run logs manually in the early period —
   the MVP Definition's stated mitigation for unreviewed public output.
3. Carry forward as known limitations, already honestly disclosed in Snapshot
   copy: no cross-source identity checking, no GBP confirmation. These bound
   what the free tier can claim, and the Snapshots are wording that correctly.

The system did the one thing this regression existed to test: it reasoned
genuinely about three different real businesses, from genuinely gathered
evidence, without manufacturing certainty, at ~$0.15 a run. That is the
validated core the public prototype was waiting for. Next steps per the Build
Order: email capture + transactional send (step 4), then domain + CTA (step 5).
