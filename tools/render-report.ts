// A4 (export step) — Growth Report Renderer (Sprint 3 Stage A).
// Converts an assembled/edited draft (markdown subset) into print-ready
// HTML with the DRDS report design system embedded (single source of
// truth for render-time tokens: DRDS_Report_Design_System_001.md).
// PDF: open in Chrome → Print → Save as PDF ("Background graphics" ON),
// or: chrome --headless --print-to-pdf="out.pdf" <file.html>
//
// Standalone dev tool. No pipeline imports. Not client-facing without
// founder review — unresolved draft markers trigger a visible banner.
//
// Usage:
//   npm run report:render -- draft.md [-o report.html]

import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";

// ---------- inline formatting ----------
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function inline(s: string): string {
  let t = escapeHtml(s);
  t = t.replace(/`([^`]+)`/g, "<code>$1</code>");
  t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  t = t.replace(/(^|[\s(])\*([^*]+)\*/g, "$1<em>$2</em>");
  t = t.replace(/(^|[\s(])_([^_]+)_/g, "$1<em>$2</em>");
  t = t.replace(/\{\{([A-Z_]+)\}\}/g, '<mark class="token">{{$1}}</mark>');
  t = t.replace(/\[FOUNDER — ([\s\S]*?)\]/g, '<span class="founder-inline">[FOUNDER — $1]</span>');
  return t;
}

const RESULT_CLASS: Record<string, string> = {
  Pass: "r-pass",
  Fail: "r-fail",
  Partial: "r-partial",
  "Not Assessed": "r-na",
  Indeterminate: "r-na",
  "Not Applicable": "r-na",
};

// ---------- block parser ----------
function renderBody(md: string): string {
  const lines = md.split(/\r?\n/);
  const out: string[] = [];
  let i = 0;

  const isTableLine = (l: string) => /^\s*\|.*\|\s*$/.test(l);

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i++;
      continue;
    }

    // HTML comments — dropped entirely (may span lines).
    if (line.trimStart().startsWith("<!--")) {
      while (i < lines.length && !lines[i].includes("-->")) i++;
      i++;
      continue;
    }

    // Raw HTML passthrough. <p …> accumulates to its close tag.
    if (/^\s*<[a-zA-Z/]/.test(line)) {
      if (/^\s*<p[\s>]/.test(line) && !line.includes("</p>")) {
        const buf = [line];
        i++;
        while (i < lines.length && !lines[i].includes("</p>")) buf.push(lines[i++]);
        if (i < lines.length) buf.push(lines[i++]);
        out.push(buf.join("<br>\n"));
      } else {
        out.push(line);
        i++;
      }
      continue;
    }

    // Headings
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      out.push(`<h${level}>${inline(h[2])}</h${level}>`);
      i++;
      continue;
    }

    // Horizontal rule
    if (/^-{3,}\s*$/.test(line)) {
      out.push("<hr>");
      i++;
      continue;
    }

    // Blockquote group
    if (/^\s*>/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ""));
        i++;
      }
      const text = buf.join(" ").trim();
      const cls = text.includes("[FOUNDER") ? ' class="founder-note"' : "";
      out.push(`<blockquote${cls}><p>${inline(text)}</p></blockquote>`);
      continue;
    }

    // Table group
    if (isTableLine(line) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      const rows: string[] = [];
      while (i < lines.length && isTableLine(lines[i])) {
        rows.push(lines[i]);
        i++;
      }
      const parse = (r: string) =>
        r
          .trim()
          .replace(/^\||\|$/g, "")
          .split(/(?<!\\)\|/)
          .map((c) => c.replace(/\\\|/g, "|").trim());
      const header = parse(rows[0]);
      const body = rows.slice(2).map(parse);
      const thead = `<thead><tr>${header.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead>`;
      const tbody = body
        .map(
          (cells) =>
            `<tr>${cells
              .map((c) => {
                const cls = RESULT_CLASS[c.trim()];
                return cls ? `<td class="${cls}">${inline(c)}</td>` : `<td>${inline(c)}</td>`;
              })
              .join("")}</tr>`
        )
        .join("\n");
      out.push(`<table>${thead}<tbody>${tbody}</tbody></table>`);
      continue;
    }

    // List group (unordered / ordered), with 2-space continuation lines.
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
        let item = lines[i].replace(/^\s*([-*]|\d+\.)\s+/, "");
        i++;
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
          item += " " + lines[i].trim().replace(/^>\s?/, "");
          i++;
        }
        items.push(`<li>${inline(item)}</li>`);
      }
      out.push(ordered ? `<ol>${items.join("")}</ol>` : `<ul>${items.join("")}</ul>`);
      continue;
    }

    // Paragraph group
    {
      const buf: string[] = [];
      while (
        i < lines.length &&
        lines[i].trim() &&
        !/^(#{1,4}\s|-{3,}\s*$|\s*>|\s*([-*]|\d+\.)\s|\s*\|)/.test(lines[i]) &&
        !/^\s*<[a-zA-Z/]/.test(lines[i])
      ) {
        buf.push(lines[i]);
        i++;
      }
      out.push(`<p>${inline(buf.join(" "))}</p>`);
    }
  }

  return out.join("\n");
}

// ---------- design system CSS (spec: DRDS_Report_Design_System_001.md) ----------
const CSS = `
:root{
  --navy:#0d1b2a; --charcoal:#2c3e50; --ink:#1a202c; --muted:#4a5568;
  --faint:#718096; --gold:#c9a84c; --gold-deep:#b8963f; --paper:#ffffff;
  --wash:#f7f8fa; --line:#e2e8f0;
}
*{box-sizing:border-box}
@page{size:A4 portrait;margin:22mm 18mm 20mm 22mm}
html{font-size:10.5pt}
body{
  font-family:"Inter","Segoe UI",system-ui,sans-serif;color:var(--ink);
  background:var(--paper);line-height:1.55;margin:0;
}
main{max-width:172mm;margin:0 auto;padding:8mm 0 18mm}
h1,h2{font-family:"Playfair Display",Georgia,serif;color:var(--charcoal);font-weight:600}
h1{font-size:26pt;line-height:1.15;margin:0 0 8mm}
h2{font-size:16pt;line-height:1.25;margin:14mm 0 5mm;page-break-after:avoid}
h3,h4{
  font-family:"Inter Tight","Inter","Segoe UI",sans-serif;text-transform:uppercase;
  letter-spacing:.12em;font-size:10.5pt;color:var(--muted);margin:8mm 0 3mm;
  page-break-after:avoid;font-weight:600
}
p{margin:0 0 4mm;max-width:68ch}
strong{color:var(--charcoal)}
hr{border:none;border-top:1pt solid var(--line);margin:9mm 0}
ul,ol{margin:0 0 4mm;padding-left:5mm}
li{margin-bottom:2mm;max-width:66ch}
code{font-family:Consolas,monospace;font-size:9pt;background:var(--wash);padding:0 .3em}

.kicker{
  font-family:"Inter Tight","Inter",sans-serif;text-transform:uppercase;
  letter-spacing:.18em;font-size:9pt;color:var(--gold);margin:0 0 4mm;font-weight:600
}
.emphasis,p.emphasis{
  font-family:"Playfair Display",Georgia,serif;font-style:italic;font-size:14pt;
  line-height:1.4;color:var(--charcoal);border-left:3pt solid var(--gold);
  padding-left:6mm;margin:6mm 0;max-width:60ch
}
section.cover{
  background:var(--navy);color:#fff;padding:30mm 20mm 24mm;margin:0 0 12mm;
  page-break-after:always;min-height:240mm
}
section.cover h1{color:#fff;font-size:30pt;margin:60mm 0 8mm}
section.cover .kicker{color:var(--gold)}
section.cover p{color:#a9b6c6;font-size:10pt}
section.cover::after{
  content:"DRDS — DR DIGITAL SYSTEMS";display:block;margin-top:50mm;
  font-family:"Inter Tight","Inter",sans-serif;letter-spacing:.2em;font-size:6.5pt;color:#a9b6c6
}
.cover-meta{border-top:2pt solid var(--gold);padding-top:5mm;width:60%}

table{width:100%;border-collapse:collapse;font-size:9pt;margin:4mm 0 7mm;page-break-inside:auto}
thead th{
  background:var(--navy);color:#fff;font-family:"Inter Tight","Inter",sans-serif;
  font-size:8.5pt;text-transform:uppercase;letter-spacing:.06em;text-align:left;
  padding:2.4mm 2.6mm;font-weight:600
}
tbody td{padding:2.2mm 2.6mm;border-bottom:1pt solid var(--line);vertical-align:top}
tbody tr:nth-child(even){background:var(--wash)}
tr{page-break-inside:avoid}
td.r-pass{color:#2f6f4f;font-weight:600}
td.r-fail{color:#8c3b3b;font-weight:600}
td.r-partial{color:var(--gold-deep);font-weight:600}
td.r-na{color:var(--faint);font-style:italic}

blockquote{
  margin:4mm 0;padding:3mm 5mm;background:var(--wash);
  border-left:3pt solid var(--line);color:var(--muted);font-size:9.5pt
}
blockquote.founder-note{
  border-left:3pt solid #c47f17;background:#fdf6e9;color:#7a5410
}
.founder-inline{background:#fdf6e9;color:#7a5410;padding:0 .25em;font-size:9.5pt}
mark.token{background:#fbe9e9;color:#8c3b3b;font-weight:600;padding:0 .2em}

.brief-card{
  background:var(--wash);border:1pt solid var(--line);border-left:3pt solid var(--gold);
  padding:5mm 6mm;margin:0 0 5mm;page-break-inside:avoid
}
.confidence-block{
  background:var(--wash);border:1pt solid var(--line);padding:5mm 6mm;margin:5mm 0;
  page-break-inside:avoid
}
.page-break{page-break-before:always}

.draft-banner{
  position:sticky;top:0;background:#8c3b3b;color:#fff;text-align:center;
  padding:3mm;font-size:10pt;font-weight:600;z-index:9
}
footer.print-footer{
  position:fixed;bottom:0;left:0;right:0;font-size:8pt;color:var(--faint);
  border-top:1pt solid var(--line);padding:1.6mm 0;background:var(--paper);
  display:flex;justify-content:space-between
}
footer.print-footer span{padding:0 6mm}
@media screen{
  body{background:#e9ecf0}
  main,section.cover{box-shadow:0 1px 8px rgba(13,27,42,.12)}
  main{background:var(--paper);padding:14mm 16mm 24mm;margin:8mm auto}
}
`;

// ---------- CLI ----------
function main(): void {
  const args = process.argv.slice(2);
  const inPath = args.find((a) => !a.startsWith("-"));
  if (!inPath) {
    console.error("Usage: npm run report:render -- draft.md [-o report.html]");
    process.exit(1);
  }
  const oIdx = args.indexOf("-o");
  const outPath = oIdx >= 0 && args[oIdx + 1] ? args[oIdx + 1] : inPath.replace(/\.md$/i, "") + ".html";

  const md = readFileSync(inPath, "utf8");

  const unresolved =
    (md.match(/\[FOUNDER/g)?.length ?? 0) + (md.match(/\{\{[A-Z_]+\}\}/g)?.length ?? 0) + (md.match(/✍/g)?.length ?? 0);
  const businessName = md.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? "(business)";

  const banner = unresolved
    ? `<div class="draft-banner">DRAFT — ${unresolved} unresolved founder item(s). Not for delivery.</div>`
    : "";

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>DRDS Growth Report — ${escapeHtml(businessName)}</title>
<style>${CSS}</style>
</head>
<body>
${banner}
<main>
${renderBody(md)}
</main>
<footer class="print-footer">
  <span>DRDS — DR Digital Systems</span>
  <span>Confidential — prepared for ${escapeHtml(businessName)}</span>
  <span>&nbsp;</span>
</footer>
</body>
</html>`;

  writeFileSync(outPath, html, "utf8");
  console.log(`Rendered: ${outPath}${unresolved ? `  (DRAFT banner shown — ${unresolved} unresolved item(s))` : ""}`);
  console.log(`PDF: open in Chrome → Print → Save as PDF (enable "Background graphics"), or:`);
  console.log(`  chrome --headless --print-to-pdf="report.pdf" "${outPath}"`);
}

main();
