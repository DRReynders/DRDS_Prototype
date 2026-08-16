# `tools/` — DRDS report tooling

Standalone dev tools. None of them import the pipeline, and none of them are
called by it. They exist to take a report from assembled Markdown to something a
person can read.

| Tool | Language | Markdown → | Notes |
|---|---|---|---|
| `assemble-report.ts` | TypeScript | draft Markdown | Assembles a draft from run output |
| `evidence-appendix.ts` | TypeScript | Markdown appendix | Evidence Register |
| `render-report.ts` | TypeScript | **HTML** (print → PDF via Chrome) | Screen/print path |
| `fetch-rendered.ts` | TypeScript | — | Rendered-page fetch helper |
| `build_drds_docx.py` | **Python** | **DOCX** (→ PDF via LibreOffice) | Client-deliverable path |

`render-report.ts` and `build_drds_docx.py` are **two different export paths, not
duplicates**. The TypeScript one produces HTML for screen and Chrome print. The
Python one produces a Word document, which is what a client engagement actually
delivers, and it is the one validated against approved baselines.

---

## `build_drds_docx.py` — Markdown → DOCX export renderer

### Status: promoted rehearsal tool

This is the only Python file in the repo. That is deliberate and it is not a
statement of architectural direction.

It was built and proven during the **iSmile Dental CT rehearsal**, where it
produced the two approved export baselines (Owner Report v4.6, Practitioner
Brief v2.5). It was promoted here because it is load-bearing and was previously
version-controlled nowhere. **Whether DRDS eventually wants a TypeScript port
alongside the other tools is still an open decision** — promoting the working
tool does not settle it, and nothing here should be read as having settled it.

It depends on `python-docx`, which has no equivalent in the Node ecosystem that
produces Word-native output at this quality. A port would mean writing OOXML by
hand. That is the actual cost to weigh whenever the decision is taken.

### 1. What it does

Converts one DRDS report Markdown file into one styled DOCX, applying the DRDS
visual system: navy headings, charcoal body, muted gold rules, warm off-white
callout panels, and a visually distinct muted-red treatment for internal-only
blocks.

Handled Markdown constructs:

| Markdown | DOCX result |
|---|---|
| `#` (first) | Report title, navy, no page break |
| `#` (subsequent) | Section heading, page break before, gold rule beneath |
| `##` / `###` | Sub-headings, navy, `keepNext` |
| `>` blockquote | Single-cell borderless panel, shaded, coloured left bar |
| `>` containing an internal marker | Same panel, muted red treatment |
| `\|` table | Horizontal-rule-only table; blank header ⇒ label/value styling |
| `- ` bullet | List Bullet, wrapped continuation lines joined |
| `---` | Rule, suppressed near headings and on the cover |
| `**bold**` `*italic*` `` `code` `` | Bold, italic, monospace grey |
| `![]()` | Logo image at configured width |
| `<!-- -->` | Rendered full, compact, or suppressed by flag |

### 2. How to run it

```bash
py -3 tools/build_drds_docx.py --config <your-config.json>
```

On this machine the `python` on PATH resolves to a Windows Store shim **without**
`python-docx`. Use `py -3`, or the interpreter at
`%LOCALAPPDATA%\Programs\Python\Python313\python.exe`.

### 3. Dependency

```bash
py -3 -m pip install python-docx
```

That is the only dependency. It is intentionally not in `package.json` — this
tool is outside the Node dependency graph.

### 4. Input

One Markdown file (`source_md`), plus a logo in `assets_dir`. Nothing else is
read. It never reads a DOCX.

### 5. Output

One DOCX at `out_docx`. Nothing else is written or modified.

### 6. PDF is a separate step

PDF conversion is **not** part of this tool and should not be added to it.
Convert with LibreOffice headless:

```bash
soffice --headless --convert-to pdf --outdir <export-dir> <file.docx>
```

Keeping it separate means a failed conversion can never corrupt a good DOCX, and
the DOCX stays the single build artefact the checks run against.

### 7. Markdown is the source of truth

**The DOCX is generated output.** The renderer must never write back to the
Markdown, and must never be used to "fix" content. Content problems are fixed in
the Markdown and re-exported. Every build re-reads the source afterwards and
fails if it changed.

A DOCX edited by hand is silently destroyed by the next build, and every QA
guarantee — which was established against the Markdown — stops describing the
file anyone is holding.

### 8. Config-driven behaviour

Every palette value, type size, page setting and guardrail switch is
configuration. The renderer contains no document-specific logic. Two document
shapes already build from one code path with zero code branching between them —
that is the evidence the design holds.

**Per-document configs, not per-document scripts.** If a new document type seems
to need a code change, check first whether it needs a config value instead.

Start from the examples:

- `drds_owner_report_docx_config.example.json`
- `drds_practitioner_brief_docx_config.example.json`

Copy, replace the four path keys, and keep the rest unless you have a reason.

### 9. A4 is the default

A4, always, unless `page_size` is deliberately set to `Letter`. `python-docx`
defaults to Letter when nothing sets a page size, and three early rehearsal
exports shipped at the wrong size exactly that way. The post-build check verifies
the built file matches the configured size.

### 10. Internal-marker guard

`render_internal_markers` must stay `true` until a recorded client-ready
decision. If it is switched off while the source Markdown still declares itself
a rehearsal draft, **the build refuses and writes no file**. Suppressing internal
markers is a client-ready action and must never happen by accident.

### 11. An unreadable explicit config aborts the build

If a config is named with `--config` and cannot be read or parsed, the build
**aborts**. It never falls back to defaults. This exists because a silent
fallback once overwrote an approved export with a different document's build.

Relatedly, the embedded defaults hold **no paths at all** — only style and
behaviour. A build with no `root` / `source_md` / `out_docx` / `assets_dir`
aborts and names the missing keys. This is the one behavioural difference from
the rehearsal copy of the script, and it exists so shared tooling cannot carry
one engagement's paths into another's build.

### 12. Rehearsal vs client-ready

A **rehearsal** build renders every internal marker: rehearsal boundaries,
placeholders, Product Council brackets, Evidence Register brackets. A
**client-ready** build does not — and producing one is a recorded decision, made
in the Markdown and the QA trail, never by flipping a flag mid-build.

Source comments are treated differently from internal markers, on purpose: they
are build metadata, not safety markers, so they are suppressed on the cover (the
document should open on the logo) while every safety marker always renders.

### 13. Per-document configs are editorial data

`no_page_break_h1_prefixes` in particular is **a judgement about which sections
of a specific document are load-bearing.** It is kept as data so no document's
structure is hard-coded into the renderer.

The validated policies, and the principle behind each:

| Document | Setting | Principle |
|---|---|---|
| Owner Report | `["6.", "7.", "8."]` | Diagnostic sections break; supporting sections flow |
| Practitioner Brief | `["Before you start"]` | Work items break; closing support flows |

**Do not copy either list to a new document type.** Carry the principle, decide
the list. Note that the two examples do not even match on the same kind of thing
— one on section numbers, one on heading text — because the documents are
numbered differently.

A heading exempted from its page break is treated **identically to every other
section heading apart from the missing break**: same navy heading, same gold
rule, same spacing. It receives **no extra space above it**. The structure is
carried by the heading treatment alone, and the approved baselines were reviewed
and approved that way.

> Historical note, worth stating because it was believed for a while: earlier
> experiment notes claimed a flowing heading received 22 pt of space above it.
> It never did — the assignment was overwritten before it reached any output.
> The dead code and the claim are both gone. Do not reintroduce either.

### 14. Post-build checks

Seven checks run automatically after every build; a critical failure exits
non-zero:

page size matches config · no stray Markdown markers survived conversion ·
rehearsal boundary present while in rehearsal mode · callout panels carry split
protection · short tables carry split protection · output path matches config ·
source Markdown unchanged by the build.

### 15. Known limitation — pagination cannot be checked here

**The checks verify that the protections were applied, not that nothing actually
split.** Page breaks are decided by whatever renders the file — Word,
LibreOffice — not by `python-docx`. The tool prints this limitation itself rather
than implying coverage it does not have.

Still requires a human or PDF check on every build: actual page count, DOCX/PDF
pagination match, and visual confirmation that no panel or table split.

### 16. Validated document shapes

| Shape | Baseline | Status |
|---|---|---|
| Owner Report | v4.6 | Validated, DOCX and PDF |
| Practitioner Brief | v2.5 | Validated, DOCX and PDF |

**Warning: assume a third document shape will expose a new rendering defect.**

This is an observation, not a worry. Every structural change so far has exposed
exactly one pagination defect that the previous state could not: the Brief
exposed table splitting, an opening-order change exposed callout splitting, and
the shared cosmetic pass exposed blank-header styling. **All three were invisible
in the Markdown and only appeared after conversion.**

So: test each new document type end to end, including the PDF leg. Do not assume
coverage from the two shapes above.
