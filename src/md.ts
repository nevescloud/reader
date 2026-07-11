// Minimal markdown -> clean reading HTML for the e-ink reader: paragraphs,
// headings (shifted down one — the page renders the title as <h1>), unordered
// lists, links, images, bold, italic, GFM tables, and SVG (fenced ```svg or a
// raw <svg> block) for diagrams/art/charts. SVG is the rich path e-ink renders
// crisply; raw HTML/JS is deliberately NOT supported (device can't use it +
// injection footgun) — only sanitized SVG passes through unescaped.

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Same footgun threat model as sanitizeSvg: the author is Claude, but a
// javascript: URL shouldn't survive a paste-through either.
function safeUrl(u: string): string {
  return /^https?:\/\//i.test(u.trim()) ? u.trim() : "";
}

function inline(s: string): string {
  s = esc(s);
  // Code spans first, parked in placeholders so *…* inside `code` stays literal.
  const codes: string[] = [];
  s = s.replace(/`([^`]+)`/g, (_m, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
  s = s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, a, u) => { const h = safeUrl(u); return h ? `<img alt="${a}" src="${h}">` : a; });
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, t, u) => { const h = safeUrl(u); return h ? `<a href="${h}">${t}</a>` : t; });
  s = s.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
  s = s.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "<i>$1</i>");
  // Underscore emphasis — models emit it as freely as asterisks. The \w
  // lookarounds keep snake_case identifiers untouched (an interior _ is
  // preceded by a word char, so it never opens a span).
  s = s.replace(/(?<![\w])__(?!_)([^_]+)__(?![\w])/g, "<b>$1</b>");
  s = s.replace(/(?<![\w])_([^_]+)_(?![\w])/g, "<i>$1</i>");
  s = s.replace(/\u0000(\d+)\u0000/g, (_m, i) => `<code>${codes[+i]}</code>`);
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
// Indent-tolerant: a nested "  - item" joins the same list (instead of snapping
// it shut and rendering as a literal-dash paragraph) but keeps its depth as an
// indent class (i1–i3, styled by the reader page) so hierarchy stays visible.
const isUl = (l: string): boolean => /^\s{0,8}[-*]\s+/.test(l);
const isOl = (l: string): boolean => /^\s{0,8}\d{1,3}[.)]\s+/.test(l);
const indentClass = (l: string): string => {
  const depth = Math.min(Math.floor((/^\s*/.exec(l)?.[0].length ?? 0) / 2), 3);
  return depth ? ` class="i${depth}"` : "";
};
const isQuote = (l: string): boolean => /^\s{0,3}>/.test(l);
const isHr = (l: string): boolean => /^(?:-{3,}|\*{3,}|_{3,})$/.test(l.trim());

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

    // horizontal rule (checked before lists: "---" would otherwise never match)
    if (isHr(line)) { out.push("<hr>"); i++; continue; }

    // blockquote: consecutive > lines, one quote block
    if (isQuote(line)) {
      const buf: string[] = [];
      while (i < lines.length && isQuote(lines[i])) { buf.push(lines[i].replace(/^\s{0,3}>\s?/, "")); i++; }
      out.push(`<blockquote><p>${inline(buf.join(" "))}</p></blockquote>`);
      continue;
    }

    // unordered list
    if (isUl(line)) {
      const items: string[] = [];
      while (i < lines.length && isUl(lines[i])) { items.push(`<li${indentClass(lines[i])}>${inline(lines[i].replace(/^\s*[-*]\s+/, ""))}</li>`); i++; }
      out.push("<ul>" + items.join("") + "</ul>");
      continue;
    }

    // ordered list — Claude numbers things constantly; these used to collapse
    // into a single run-on paragraph
    if (isOl(line)) {
      const start = parseInt(line.trim(), 10);
      const items: string[] = [];
      while (i < lines.length && isOl(lines[i])) { items.push(`<li${indentClass(lines[i])}>${inline(lines[i].replace(/^\s*\d{1,3}[.)]\s+/, ""))}</li>`); i++; }
      out.push(`<ol${start !== 1 ? ` start="${start}"` : ""}>` + items.join("") + "</ol>");
      continue;
    }

    // paragraph: gather consecutive plain lines
    const blocky = (idx: number): boolean =>
      /^(#{1,6})\s+/.test(lines[idx]) || isUl(lines[idx]) || isOl(lines[idx]) || isQuote(lines[idx]) || isHr(lines[idx]) ||
      /^```/.test(lines[idx].trim()) || /^<svg[\s>]/i.test(lines[idx].trim()) ||
      (isTableRow(lines[idx]) && idx + 1 < lines.length && isTableSep(lines[idx + 1]));
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() !== "" && !blocky(i)) {
      para.push(lines[i]); i++;
    }
    if (para.length) out.push(`<p>${inline(para.join(" "))}</p>`);
    else i++; // a blocky line the dispatchers above didn't consume — never stall
  }
  return out.join("");
}

// A leading "# H1" sits in title position: ALWAYS dropped from the body,
// adopted as the title when none was given. Precedence: explicit > H1 > fallback.
// (Must drop unconditionally: append re-renders the full source with the
// previously-extracted title now explicit — if the H1 were kept in that pass,
// the new html wouldn't extend the old and the device would lose its place.)
export function render(md: string, explicitTitle?: string): { title: string; html: string } {
  let src = (md || "").trim();
  let title = (explicitTitle || "").trim();
  const m = /^#\s+(.+?)(?:\n|$)/.exec(src);
  if (m) { if (!title) title = m[1].trim(); src = src.slice(m[0].length).trim(); }
  return { title: title || "Reading", html: mdToHtml(src) };
}
