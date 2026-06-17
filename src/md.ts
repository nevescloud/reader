// Minimal markdown -> clean reading HTML for the e-ink reader: paragraphs,
// headings (shifted down one — the page renders the title as <h1>), unordered
// lists, links, images, bold, italic, GFM tables, and SVG (fenced ```svg or a
// raw <svg> block) for diagrams/art/charts. SVG is the rich path e-ink renders
// crisply; raw HTML/JS is deliberately NOT supported (device can't use it +
// injection footgun) — only sanitized SVG passes through unescaped.

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function inline(s: string): string {
  s = esc(s);
  s = s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, a, u) => `<img alt="${a}" src="${u}">`);
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, t, u) => `<a href="${u}">${t}</a>`);
  s = s.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
  s = s.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "<i>$1</i>");
  return s;
}

// Author is the authenticated user, so this guards against footguns (a stray
// <script>, an event handler, an HTML-smuggling <foreignObject>) rather than a
// determined attacker. Only emit if it's a single <svg> root.
function sanitizeSvg(svg: string): string {
  let s = svg.trim();
  if (!/^<svg[\s>]/i.test(s)) return "";
  s = s.replace(/<script[\s\S]*?<\/script>/gi, "");
  s = s.replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, "");
  s = s.replace(/\son\w+\s*=\s*"[^"]*"/gi, "");
  s = s.replace(/\son\w+\s*=\s*'[^']*'/gi, "");
  s = s.replace(/(href|xlink:href)\s*=\s*"\s*javascript:[^"]*"/gi, "");
  s = s.replace(/(href|xlink:href)\s*=\s*'\s*javascript:[^']*'/gi, "");
  return s;
}

function cells(row: string): string[] {
  return row.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim());
}
const isTableSep = (l: string): boolean => /\|/.test(l) && /^[\s|:-]+$/.test(l) && /-/.test(l);
const isTableRow = (l: string): boolean => l.includes("|");

export function mdToHtml(md: string): string {
  const lines = md.replace(/\r\n/g, "\n").trim().split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") { i++; continue; }

    // fenced block: ```svg / ```lang / ```
    const fence = /^```(\w*)\s*$/.exec(line.trim());
    if (fence) {
      i++;
      const buf: string[] = [];
      while (i < lines.length && !/^```\s*$/.test(lines[i].trim())) { buf.push(lines[i]); i++; }
      i++; // closing fence
      const code = buf.join("\n");
      const svg = fence[1].toLowerCase() === "svg" ? sanitizeSvg(code) : "";
      out.push(svg ? `<div class=svgwrap>${svg}</div>` : `<pre><code>${esc(code)}</code></pre>`);
      continue;
    }

    // raw <svg>…</svg> block (possibly multi-line)
    if (/^<svg[\s>]/i.test(line.trim())) {
      const buf: string[] = [];
      while (i < lines.length) { buf.push(lines[i]); if (/<\/svg>/i.test(lines[i])) { i++; break; } i++; }
      const svg = sanitizeSvg(buf.join("\n"));
      if (svg) { out.push(`<div class=svgwrap>${svg}</div>`); continue; }
      // not valid svg → fall through as paragraph
    }

    // heading
    const h = /^(#{1,6})\s+(.*)/.exec(line);
    if (h) { const lvl = Math.min(h[1].length + 1, 4); out.push(`<h${lvl}>${inline(h[2])}</h${lvl}>`); i++; continue; }

    // table: a row followed by a separator row
    if (isTableRow(line) && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const head = cells(line);
      i += 2;
      const body: string[][] = [];
      while (i < lines.length && isTableRow(lines[i]) && lines[i].trim() !== "") { body.push(cells(lines[i])); i++; }
      let tbl = "<table><thead><tr>" + head.map((c) => `<th>${inline(c)}</th>`).join("") + "</tr></thead><tbody>";
      for (const r of body) tbl += "<tr>" + r.map((c) => `<td>${inline(c)}</td>`).join("") + "</tr>";
      out.push(tbl + "</tbody></table>");
      continue;
    }

    // unordered list
    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) { items.push(`<li>${inline(lines[i].replace(/^[-*]\s+/, ""))}</li>`); i++; }
      out.push("<ul>" + items.join("") + "</ul>");
      continue;
    }

    // paragraph: gather consecutive plain lines
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() !== "" && !/^(#{1,6})\s+/.test(lines[i]) && !/^[-*]\s+/.test(lines[i]) && !/^```/.test(lines[i].trim()) && !/^<svg[\s>]/i.test(lines[i].trim()) && !(isTableRow(lines[i]) && i + 1 < lines.length && isTableSep(lines[i + 1]))) {
      para.push(lines[i]); i++;
    }
    if (para.length) out.push(`<p>${inline(para.join(" "))}</p>`);
  }
  return out.join("");
}

// A leading "# H1" is the title (rendered separately) — adopt it when no explicit
// title was given, and drop it from the body. Precedence: explicit > H1 > fallback.
export function render(md: string, explicitTitle?: string): { title: string; html: string } {
  let src = (md || "").trim();
  let title = (explicitTitle || "").trim();
  const m = /^#\s+(.+?)(?:\n|$)/.exec(src);
  if (m && !title) { title = m[1].trim(); src = src.slice(m[0].length).trim(); }
  return { title: title || "Reading", html: mdToHtml(src) };
}
