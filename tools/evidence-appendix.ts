// A1 — Evidence Appendix Generator (Sprint 3 Stage A).
// Converts a stored run log (runs/*.json) into the Growth Report's
// Evidence Register as markdown. Standalone dev tool: reads a JSON file,
// writes markdown. Imports from src/ are TYPE-ONLY (erased at runtime),
// so nothing in the reasoning pipeline or Contracts 0–5 is touched.
//
// Usage:
//   npm run report:appendix -- runs/<runlog>.json [-o out.md]

import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import type { EvidenceEntry, RunLog } from "../src/types.js";

// Human-readable check questions for the current fixed evidence subset.
// Deliberately duplicated from src/evidence/checks.ts META (which is not
// exported) so this tool never requires a pipeline change. If checks.ts
// gains items (e.g. a future Report-mode pass), extend this map; unknown
// IDs degrade gracefully to the entry's growthFunction/evidenceType.
const QUESTIONS: Record<string, string> = {
  "E-VIS-001": "Unique, descriptive title tags on core pages",
  "E-VIS-002": "Unique meta descriptions on core pages",
  "E-VIS-003": "Single clear H1 per page, matching page topic",
  "E-VIS-016": "Valid SSL certificate (HTTPS)",
  "E-VIS-041": "Comprehensive core page set (services, about, testimonials, blog/resources)",
  "E-VIS-004": "Name, Address, Phone identical everywhere they appear",
  "E-VIS-027": "Credibility badges / third-party recognition visible",
  "E-CON-017": "Customer testimonials on the site itself",
  "E-CON-018": "Case studies or before/after proof of results",
  "E-VIS-018": "Claimed, active Google Business Profile",
  "E-VIS-037": "Google Business Profile verified",
  "E-VIS-020": "Healthy volume of recent GBP reviews",
  "E-SCA-001": "Structured client retention process (as publicly claimed)",
};

const BAND_SHORT: Record<string, string> = {
  "Publicly Observable": "Public",
  "Client Access Required": "Client access",
  "Third-Party Tool Required": "Tool",
};

function esc(s: string): string {
  // Keep markdown table cells intact.
  return s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
}

function shortSource(source: string): string {
  const parts = source.split(/,\s*/).filter(Boolean);
  if (parts.length <= 1) return esc(source);
  return `${esc(parts[0])} (+${parts.length - 1} more)`;
}

function questionFor(e: EvidenceEntry): string {
  return QUESTIONS[e.evidenceId] ?? `${e.growthFunction} — ${e.evidenceType}`;
}

export function buildEvidenceRegister(log: RunLog): string {
  const entries = log.evidencePackage?.entries ?? [];
  if (!entries.length) {
    return "_No evidence entries found in this run log — the run may have failed before Contract 3._";
  }

  const lines: string[] = [];

  // Summary counts.
  const counts = new Map<string, number>();
  for (const e of entries) counts.set(e.resultStatus, (counts.get(e.resultStatus) ?? 0) + 1);
  const countLine = [...counts.entries()].map(([k, v]) => `${v} ${k}`).join(" · ");
  lines.push(`**${entries.length} checks recorded** — ${countLine}.`);
  lines.push("");
  if (log.evidencePackage?.evidenceCoverage) {
    lines.push(`**Coverage (as recorded by the pipeline):** ${log.evidencePackage.evidenceCoverage.trim()}`);
    lines.push("");
  }

  // Group by growth function, preserving first-seen order.
  const groups = new Map<string, EvidenceEntry[]>();
  for (const e of entries) {
    const g = groups.get(e.growthFunction) ?? [];
    g.push(e);
    groups.set(e.growthFunction, g);
  }

  for (const [fn, group] of groups) {
    lines.push(`### ${fn}`);
    lines.push("");
    lines.push("| ID | Check | Result | What we observed | Source | Band |");
    lines.push("|---|---|---|---|---|---|");
    for (const e of group) {
      lines.push(
        `| ${e.evidenceId} | ${esc(questionFor(e))} | ${e.resultStatus} | ${esc(e.evidenceValue)} | ${shortSource(e.source)} | ${BAND_SHORT[e.evidenceAccessibility] ?? esc(e.evidenceAccessibility)} |`
      );
    }
    lines.push("");
  }

  // Cross-reference: which register rows the reasoning actually leaned on.
  const rr = log.reasoningResult;
  if (rr) {
    if (rr.supportingEvidence.length) {
      lines.push("### Cited as supporting the finding");
      lines.push("");
      for (const ref of rr.supportingEvidence) {
        lines.push(`- **${ref.evidenceId}** — ${ref.why.trim()}`);
      }
      lines.push("");
    }
    lines.push("### Evidence checked against the finding");
    lines.push("");
    if (rr.contradictoryEvidence.length) {
      for (const ref of rr.contradictoryEvidence) {
        lines.push(`- **${ref.evidenceId}** — ${ref.why.trim()}`);
      }
    } else {
      lines.push("- Contradictory evidence was actively looked for; none was found.");
    }
    lines.push("");
  }

  // Honest-limits notes for anything not cleanly assessed.
  const flagged = entries.filter((e) =>
    ["Not Assessed", "Indeterminate", "Partial", "Not Applicable"].includes(e.resultStatus)
  );
  if (flagged.length) {
    lines.push("### Notes on items not fully assessed");
    lines.push("");
    for (const e of flagged) {
      lines.push(`- **${e.evidenceId} (${e.resultStatus})** — ${esc(questionFor(e))}. ${esc(e.observation)}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

// ---- CLI ----
function main(): void {
  const args = process.argv.slice(2);
  const inPath = args.find((a) => !a.startsWith("-"));
  if (!inPath) {
    console.error("Usage: npm run report:appendix -- runs/<runlog>.json [-o out.md]");
    process.exit(1);
  }
  const oIdx = args.indexOf("-o");
  const outPath =
    oIdx >= 0 && args[oIdx + 1]
      ? args[oIdx + 1]
      : `evidence-register-${basename(inPath).replace(/\.json$/i, "")}.md`;

  const log = JSON.parse(readFileSync(inPath, "utf8")) as RunLog;
  const md = [
    `## Appendix — Evidence Register`,
    "",
    `_Business input: ${log.input?.rawInputValue ?? "(unknown)"} · Run: ${log.runId ?? basename(inPath)}_`,
    "",
    buildEvidenceRegister(log),
  ].join("\n");

  writeFileSync(outPath, md, "utf8");
  console.log(`Evidence register written: ${outPath}`);
}

// Run only when invoked directly (not when imported by assemble-report).
if (process.argv[1] && /evidence-appendix\.(ts|js)$/.test(process.argv[1])) {
  main();
}
