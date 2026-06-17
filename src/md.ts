// Minimal markdown -> clean reading HTML. Same shape as the static kindle
// repo's build.py: paragraphs, headings (shifted down one — the page renders
// the title as <h1>), unordered lists, links, images, bold, italic.

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

export function mdToHtml(md: string): string {
  const out: string[] = [];
  for (let block of md.trim().split(/\n\s*\n/)) {
    block = block.trim();
    if (!block) continue;
    const h = /^(#{1,6})\s+(.*)/.exec(block);
    if (h) {
      const lvl = Math.min(h[1].length + 1, 4);
      out.push(`<h${lvl}>${inline(h[2])}</h${lvl}>`);
      continue;
    }
    const lines = block.split("\n");
    if (lines.every((ln) => /^[-*]\s+/.test(ln))) {
      out.push("<ul>" + lines.map((ln) => `<li>${inline(ln.replace(/^[-*]\s+/, ""))}</li>`).join("") + "</ul>");
      continue;
    }
    out.push(`<p>${inline(lines.join(" "))}</p>`);
  }
  return out.join("");
}

// A leading "# H1" is the title (which the page renders separately) — adopt it
// when no explicit title was given, and drop it from the body so it isn't shown
// twice. Mirrors kindle-add's from_md precedence: explicit > H1 > fallback.
export function render(md: string, explicitTitle?: string): { title: string; html: string } {
  let src = (md || "").trim();
  let title = (explicitTitle || "").trim();
  const m = /^#\s+(.+?)(?:\n|$)/.exec(src);
  if (m && !title) {
    title = m[1].trim();
    src = src.slice(m[0].length).trim();
  }
  return { title: title || "Reading", html: mdToHtml(src) };
}
