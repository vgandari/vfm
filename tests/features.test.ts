/**
 * Rendering of the features that make vfm a flavor of its own (README "Syntax extensions"), in document mode.
 * The CommonMark and GFM constructs are in conformance.test.ts. Raw HTML is shown as text (REQ-022); that is checked
 * once, at low priority, because it is the absence of a feature.
 *
 * Each test names the requirements (docs/REQUIREMENTS.md) and use cases (docs/USE_CASES.md) it verifies.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { loadApi } from "./helpers/loadApi.ts";

const t = loadApi();
let log = console.log;
before(async () => {
  await t.load();
  log = console.log;
  console.log = (...a: unknown[]) => (String(a[0]).startsWith("[codeHandler]") ? undefined : log(...a));
});
after(() => {
  console.log = log;
  t.cleanup();
});

/** Document-mode HTML without source-line attributes. */
const doc = (md: string, opts: Record<string, unknown> = {}) =>
  t.state.ssr.renderToStaticMarkup(t.state.ssr.renderMarkdown(md, { numberingDepth: 0, numberCaptions: "all", ...opts })).replace(/\sdata-line="\d+"/g, "");
const text = (html: string) => html.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

// ─── Alerts ──────────────────────────────────────────────────────────────────

// Verifies REQ-308 (UC-45)
test("alerts: NOTE, TIP, IMPORTANT, WARNING and CAUTION become a titled box of their own class", () => {
  for (const kind of ["NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION"]) {
    const html = doc(`> [!${kind}]\n> Body text.\n`);
    const name = kind[0] + kind.slice(1).toLowerCase();
    assert.match(html, new RegExp(`<div class="alert alert-${kind.toLowerCase()}">`), kind);
    assert.match(html, new RegExp(`<p class="alert-title">${name}</p>`), kind);
    assert.match(html, /<p>Body text\.<\/p>/, kind);
  }
});

// Verifies REQ-308 (UC-45)
test("alerts: the marker is case-insensitive and keeps inline Markdown and further paragraphs", () => {
  const html = doc("> [!note]\n> **Bold** and `code`.\n>\n> Second paragraph.\n");
  assert.match(html, /alert-note/);
  assert.match(html, /<strong>Bold<\/strong> and <code>code<\/code>\./);
  assert.match(html, /<p>Second paragraph\.<\/p>/);
});

// Verifies REQ-308 (UC-45)
test("alerts: an unknown type, or a marker followed by text on its line, stays a block quote", () => {
  assert.match(doc("> [!BOGUS]\n> x\n"), /class="blockquote"/);
  assert.doesNotMatch(doc("> [!BOGUS]\n> x\n"), /alert/);
  assert.doesNotMatch(doc("> [!NOTE] Custom\n> body\n"), /class="alert/);
});

// ─── Highlight ───────────────────────────────────────────────────────────────

// Verifies REQ-309 (UC-45)
test("highlight: ==text== is a mark, and the mark can sit inside other inline Markdown", () => {
  assert.match(doc("Some ==marked text== here.\n"), /Some <mark>marked text<\/mark> here\./);
  assert.match(doc("a **==both==** b\n"), /<strong><mark>both<\/mark><\/strong>/);
});

// Verifies REQ-314 (UC-45)
test("highlight: emphasis written inside the marks is rendered", () => {
  assert.match(doc("==a **bold** word==\n"), /<mark>a <strong>bold<\/strong> word<\/mark>/);
});

// Verifies REQ-309 (UC-45)
test("highlight: code and a lone == are left alone", () => {
  assert.match(doc("`==not marked==`\n"), /<code>==not marked==<\/code>/);
  assert.doesNotMatch(doc("if a == b then c\n"), /<mark>/);
});

// ─── Math ────────────────────────────────────────────────────────────────────

// Verifies REQ-310 (UC-45)
test("math: $…$ is inline KaTeX and $$…$$ is a display block", () => {
  const inline = doc("Energy is $E = mc^2$ here.\n");
  assert.match(inline, /class="math math-inline"/);
  assert.match(inline, /class="katex"/);
  assert.match(inline, /<annotation encoding="application\/x-tex">E = mc\^2<\/annotation>/);
  const display = doc("$$\n\\int_0^1 x\\,dx = \\tfrac12\n$$\n");
  assert.match(display, /class="katex-display"|math-display|equation-block/);
  assert.match(display, /<annotation encoding="application\/x-tex">/);
});

// Verifies REQ-310 (UC-45)
test("math: a dollar sign that never closes is text, and math in a code span is not rendered", () => {
  assert.equal(text(doc("It costs $5 today.\n")).trim(), "It costs $5 today.");
  const code = doc("`$x$`\n");
  assert.match(code, /<code>\$x\$<\/code>/);
  assert.doesNotMatch(code, /katex/);
});

// ─── Theorem-style environments (fenced divs) ────────────────────────────────

// Verifies REQ-311 (UC-45)
test("fenced divs: :::theorem is numbered and titled, and [@thm:x] links to it", () => {
  const html = doc(":::theorem Pythagoras {#thm:p}\nIn a right triangle $a^2+b^2=c^2$.\n:::\n\nSee [@thm:p].\n");
  assert.match(html, /id="thm:p"/);
  assert.match(html, /Theorem 1 — Pythagoras/);
  assert.match(html, /<a href="#thm:p" class="xref">Theorem 1<\/a>/);
});

// Verifies REQ-311 (UC-45)
test("fenced divs: every alias gives its own kind and each kind counts separately", () => {
  const names: Record<string, string> = { thm: "Theorem", lem: "Lemma", cor: "Corollary", prp: "Proposition", cnj: "Conjecture", def: "Definition", exm: "Example", exr: "Exercise", hyp: "Hypothesis" };
  for (const [alias, name] of Object.entries(names)) {
    const html = doc(`:::${alias} A name {#${alias}:one}\nBody.\n:::\n\n:::${alias} Another {#${alias}:two}\nBody.\n:::\n`);
    assert.match(html, new RegExp(`${name} 1 — A name`), alias);
    assert.match(html, new RegExp(`${name} 2 — Another`), alias);
  }
});

// ─── Numbering, labels and cross-references ──────────────────────────────────

// Verifies REQ-312 (UC-46)
test("headings: numberingDepth 0 writes no section numbers, a positive depth numbers headings", () => {
  const md = "# One\n\n## Two\n\n# Three\n";
  assert.doesNotMatch(doc(md, { numberingDepth: 0 }), /section-number/);
  const numbered = doc(md, { numberingDepth: 2 });
  assert.match(numbered, /<span class="section-number">1<\/span> One/);
  assert.match(numbered, /<span class="section-number">1\.1<\/span> Two/);
  assert.match(numbered, /<span class="section-number">2<\/span> Three/);
});

// Verifies REQ-312 (UC-46)
test("headings: headingShift moves every heading down that many levels", () => {
  const html = doc("# Top\n\n## Next\n", { headingShift: 1 });
  assert.match(html, /<h2[^>]*>Top<\/h2>/);
  assert.match(html, /<h3[^>]*>Next<\/h3>/);
});

// Verifies REQ-019 (UC-05)
test("labels: a figure, a listing and a labelled heading are numbered and cross-referenced", () => {
  const html = doc("![A cat](cat.png) {#fig:cat}\n\n```python Hello {#lst:h}\nprint(1)\n```\n\nSee [@fig:cat] and [@lst:h].\n");
  assert.match(html, /<figure class="labeled-figure" id="fig:cat"(?: data-line="\d+")?>.*Figure 1: A cat\./);
  assert.match(html, /<figure class="code-listing" id="lst:h"(?: data-line="\d+")?>.*Listing 1: Hello\./);
  assert.match(html, /<a href="#fig:cat" class="xref">Figure 1<\/a>/);
  assert.match(html, /<a href="#lst:h" class="xref">Listing 1<\/a>/);
});

// Verifies REQ-019, REQ-316 (UC-05)
test("labels: a paragraph that touches a table is its caption; with a blank line between it is a paragraph", () => {
  const table = "| Method | Score |\n| --- | ---: |\n| A | 1 |\n";
  const captioned = doc(`Quality of three methods. {#tab:q}\n${table}\nSee [@tab:q].\n`);
  assert.match(captioned, /<caption><strong>Table 1: Quality of three methods\.<\/strong><\/caption>/);
  assert.match(captioned, /<a href="#tab:q" class="xref">Table 1<\/a>/);
  const apart = doc(`A paragraph.\n\n${table}`);
  assert.match(apart, /<p>A paragraph\.<\/p>/);
  assert.doesNotMatch(apart, /Table 1: A paragraph/);
});

// Verifies REQ-019 (UC-05)
test("labels: display math is numbered per labelled line, and a block label is an anchor only", () => {
  const html = doc("$$\na = b {#eq:one}\nc = d {#eq:two}\n$$\n\nBy [@eq:one] and [@eq:two].\n");
  assert.match(html, /<a href="#eq:one" class="xref">Equation 1a<\/a>/);
  assert.match(html, /<a href="#eq:two" class="xref">Equation 1b<\/a>/);
});

// Verifies REQ-019 (UC-05)
test("labels: a reference to a label that does not exist is shown in red, not dropped", () => {
  assert.match(doc("See [@fig:nowhere].\n"), /<span style="color:red">\[@fig:nowhere\]<\/span>/);
});

// ─── Code blocks, footnotes, raw HTML ────────────────────────────────────────

// Verifies REQ-313 (UC-45)
test("code fences: the info string's language becomes a class and the code is highlighted", () => {
  const html = doc("```python\nprint(1)\n```\n\n```\nplain\n```\n");
  assert.match(html, /<code class="hljs language-python">.*hljs-built_in.*print/);
  assert.match(html, /<code>plain<\/code>/);
});

// Verifies REQ-306 (UC-44)
test("footnotes: references are numbered in order of use and each definition links back", () => {
  const html = doc("First[^b] then second[^a].\n\n[^a]: Alpha.\n[^b]: Beta.\n");
  assert.match(html, /First<sup><a href="#user-content-fn-b"[^>]*>1<\/a><\/sup> then second<sup><a href="#user-content-fn-a"[^>]*>2<\/a><\/sup>/);
  assert.match(html, /<li id="user-content-fn-b">\s*<p>Beta\. <a href="#user-content-fnref-b"/);
  assert.match(html, /<li id="user-content-fn-a">\s*<p>Alpha\. <a href="#user-content-fnref-a"/);
});

// Verifies REQ-022 (UC-03)
test("raw HTML is shown as text and HTML comments are invisible", () => {
  const html = doc("A <b>bold</b> move <script>alert(1)</script>\n\n<div>block</div>\n\nbefore <!-- secret --> after\n");
  assert.doesNotMatch(html, /<b>|<script|<div>/);
  assert.match(html, /&lt;b&gt;bold&lt;\/b&gt;/);
  assert.match(html, /&lt;div&gt;block&lt;\/div&gt;/);
  assert.doesNotMatch(html, /secret/);
});
