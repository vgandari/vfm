/**
 * Unit tests that import the plugins and handlers directly (no bundle), so that they count in line coverage.
 * Each test names the requirements (docs/REQUIREMENTS.md) and use cases (docs/USE_CASES.md) it verifies.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { rehype } from "rehype";
import { VFile } from "vfile";
import remarkHighlight from "../plugins/highlight.ts";
import remarkLabels from "../plugins/labels.ts";
import { highlightHandler, paragraphHandler } from "../handlers.ts";

const html = (md: string) => {
  const p = unified().use(remarkParse).use(remarkHighlight).use(remarkLabels).use(remarkRehype, { handlers: { highlight: highlightHandler, paragraph: paragraphHandler } });
  const file = new VFile(md);
  const tree = p.runSync(p.parse(file), file);
  return rehype().data("settings", { fragment: true }).stringify(tree as any).replace(/\n/g, "");
};

// Verifies REQ-309 (UC-45)
test("highlight parser: a pair needs text, and a newline or a missing close leaves it as text", () => {
  assert.equal(html("a ==b== c"), "<p>a <mark>b</mark> c</p>");
  assert.equal(html("===="), "<p>====</p>");
  assert.equal(html("a ==== b"), "<p>a ==== b</p>");
  assert.equal(html("==open"), "<p>==open</p>");
  assert.equal(html("==a\nb=="), "<p>==a\nb==</p>".replace(/\n/g, ""));
});

// Verifies REQ-314 (UC-45)
test("highlight parser: the text between the marks is inline Markdown", () => {
  assert.equal(html("==a **b** `c` [d](u) ~~e~~=="), '<p><mark>a <strong>b</strong> <code>c</code> <a href="u">d</a> <del>e</del></mark></p>');
  assert.equal(html("==a *b=="), "<p><mark>a *b</mark></p>");
});

// Verifies REQ-315 (UC-45)
test("figure paragraph: text before and after the image stays, in order; blank text around it does not add paragraphs", () => {
  const out = html("Before ![alt](x.png) after");
  assert.match(out, /^<p>Before <\/p><figure[^>]*><img src="x.png" alt="alt">.*<\/figure><p> after<\/p>$/);
  assert.match(html("![alt](x.png)"), /^<figure/);
  assert.match(html("![alt](x.png) {#fig:a}"), /^<figure[^>]*id="fig:a"/);
});

// Verifies REQ-315 (UC-45)
test("alt text: a hard break (backslash or two spaces) becomes a newline, and the markup around it is dropped", () => {
  assert.match(html("![here\\\nit is](x.png)"), /alt="here\nit is"/);
  assert.match(html("![*here*  \n**it** is](x.png)"), /alt="here\nit is"/);
  assert.match(html("![plain alt](x.png)"), /alt="plain alt"/);
});
