// Each case here enforces a scar comment or load-bearing invariant in md.ts —
// the regressions that already happened once, now mechanical.
import { describe, it, expect } from "vitest";
import { mdToHtml, render } from "../src/md";

describe("render: title extraction", () => {
  it("adopts a leading H1 as title and drops it from the body", () => {
    const r = render("# Guide\n\nPara one.");
    expect(r.title).toBe("Guide");
    expect(r.html).toBe("<p>Para one.</p>");
  });

  it("explicit title outranks the H1 — which is still dropped", () => {
    const r = render("# Guide\n\nPara one.", "Override");
    expect(r.title).toBe("Override");
    expect(r.html).not.toContain("Guide");
  });

  it("falls back to 'Reading' when neither exists", () => {
    expect(render("just a paragraph").title).toBe("Reading");
  });

  // The device keys on "new html is an exact extension of the old" to hold the
  // reading position through an append — the whole reason the H1 drop is
  // unconditional. This is the invariant behind renderDoc's isAppend check.
  it("append re-render is an exact prefix-extension of the previous render", () => {
    const first = render("# Guide\n\nPara one.");
    const appended = render("# Guide\n\nPara one.\n\nPara two.", first.title);
    expect(appended.title).toBe(first.title);
    expect(appended.html.startsWith(first.html)).toBe(true);
    expect(appended.html.length).toBeGreaterThan(first.html.length);
  });
});

describe("block structure", () => {
  it("ordered lists render as <ol>, not a run-on paragraph", () => {
    expect(mdToHtml("1. alpha\n2. beta")).toBe("<ol><li>alpha</li><li>beta</li></ol>");
  });

  it("ordered list keeps a non-1 start", () => {
    expect(mdToHtml("3. third\n4. fourth")).toContain('<ol start="3">');
  });

  it("nested list items join the list with an indent class instead of closing it", () => {
    const h = mdToHtml("- top\n  - nested");
    expect(h).toBe('<ul><li>top</li><li class="i1">nested</li></ul>');
  });

  it("headings shift down one and cap at h4", () => {
    expect(mdToHtml("## Section")).toBe("<h3>Section</h3>");
    expect(mdToHtml("###### Deep")).toBe("<h4>Deep</h4>");
  });

  it("--- is an <hr>, not a list or table separator", () => {
    expect(mdToHtml("---")).toBe("<hr>");
  });

  it("consecutive > lines merge into one blockquote", () => {
    expect(mdToHtml("> one\n> two")).toBe("<blockquote><p>one two</p></blockquote>");
  });

  it("GFM table renders head and body", () => {
    const h = mdToHtml("| a | b |\n|---|---|\n| 1 | 2 |");
    expect(h).toBe("<table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>");
  });

  it("never stalls on a blocky line no dispatcher consumed", () => {
    // a lone <svg line with no close used to be the risk shape; must terminate
    expect(() => mdToHtml("<svg>")).not.toThrow();
  });
});

describe("inline", () => {
  it("code spans keep asterisks literal", () => {
    expect(mdToHtml("`*not emphasis*`")).toBe("<p><code>*not emphasis*</code></p>");
  });

  it("snake_case identifiers are not italicized", () => {
    expect(mdToHtml("use snake_case_name here")).toBe("<p>use snake_case_name here</p>");
  });

  it("underscore emphasis works between words", () => {
    expect(mdToHtml("an _emphasized_ word")).toBe("<p>an <i>emphasized</i> word</p>");
  });

  it("bold and italic", () => {
    expect(mdToHtml("**b** and *i*")).toBe("<p><b>b</b> and <i>i</i></p>");
  });

  it("javascript: links degrade to their text", () => {
    expect(mdToHtml("[x](javascript:alert(1))")).not.toContain("<a");
    expect(mdToHtml("[x](javascript:void(0))")).not.toContain("javascript");
    expect(mdToHtml("![x](javascript:alert(1))")).not.toContain("<img");
  });

  it("https links and images pass", () => {
    expect(mdToHtml("[x](https://example.com)")).toContain('<a href="https://example.com">x</a>');
  });

  it("HTML in text is escaped", () => {
    expect(mdToHtml("<script>alert(1)</script>")).toBe("<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>");
  });
});

describe("svg", () => {
  it("fenced ```svg passes through sanitized", () => {
    const h = mdToHtml('```svg\n<svg viewBox="0 0 10 10"><rect onclick="x()" width="5"/><script>evil()</script></svg>\n```');
    expect(h).toContain("<div class=svgwrap>");
    expect(h).not.toContain("script");
    expect(h).not.toContain("onclick");
  });

  it("foreignObject (HTML smuggling) is stripped", () => {
    const h = mdToHtml("```svg\n<svg><foreignObject><body>x</body></foreignObject></svg>\n```");
    expect(h).not.toContain("foreignObject");
  });

  it("a non-svg fence is an escaped code block", () => {
    expect(mdToHtml("```js\nconst a = 1 < 2;\n```")).toBe("<pre><code>const a = 1 &lt; 2;</code></pre>");
  });

  it("raw <svg> blocks render; non-svg content falls through as paragraph", () => {
    expect(mdToHtml('<svg viewBox="0 0 1 1"><circle r="1"/></svg>')).toContain("svgwrap");
  });
});
