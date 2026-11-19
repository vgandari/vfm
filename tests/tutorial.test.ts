/**
 * The tutorial (docs/tutorial/TUTORIAL.md) is both a document for people learning Markdown and a fixture: it has to
 * render, every example in it has to work on its own, and it has to show every feature of the flavor.
 *
 * Each test names the requirements (docs/REQUIREMENTS.md) and use cases (docs/USE_CASES.md) it verifies.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadApi } from "./helpers/loadApi.ts";

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, "../docs/tutorial");
const source = readFileSync(join(dir, "TUTORIAL.md"), "utf8");

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

const render = (md: string) => t.state.ssr.renderToStaticMarkup(t.state.ssr.renderMarkdown(md, { numberingDepth: 2, numberCaptions: "all" }));
const count = (html: string, re: RegExp) => (html.match(re) ?? []).length;

/** The text of every fenced block whose info string is `markdown`: what the reader is told to type. */
function examples(md: string): string[] {
  const out: string[] = [];
  const lines = md.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const open = /^(`{3,})markdown\s*$/.exec(lines[i]);
    if (!open) continue;
    const body: string[] = [];
    for (i++; i < lines.length && !new RegExp(`^\`{${open[1].length},}\\s*$`).test(lines[i]); i++) body.push(lines[i]);
    out.push(body.join("\n") + "\n");
  }
  return out;
}

// Verifies REQ-317 (UC-43)
test("the tutorial renders as a document and every cross-reference in it resolves", () => {
  const html = render(source);
  assert.ok(html.length > 20000);
  assert.equal(count(html, /color:red/g), 0, "a [@label] points nowhere");
  assert.match(html, /<h1[^>]*><span class="section-number">1<\/span> How to use this tutorial/);
});

// Verifies REQ-317 (UC-43)
test("the tutorial shows each Markdown, GFM and VFM feature, rendered", () => {
  const html = render(source);
  const need: Record<string, RegExp> = {
    "emphasis": /<em>Italic<\/em>/,
    "strong": /<strong>Bold<\/strong>/,
    "strikethrough": /<del>Strikethrough<\/del>/,
    "underline": /<u>Underlined<\/u>/,
    "highlight": /<mark>highlighted words<\/mark>/,
    "subscript": /H<sub>2<\/sub>O/,
    "superscript": /mc<sup>2<\/sup>/,
    "headings": /<h3[^>]*>.*Task lists/,
    "ordered list": /<ol[ >]/,
    "task list": /<input type="checkbox"/,
    "block quote": /class="blockquote"/,
    "alerts": /alert-note[\s\S]*alert-tip[\s\S]*alert-important[\s\S]*alert-warning[\s\S]*alert-caution/,
    "code highlight": /language-python/,
    "link": /<a href="https:\/\/commonmark\.org" title="optional title">inline link<\/a>/,
    "image": /<img src="circle\.svg"/,
    "table": /<th[^>]*>Fruit<\/th>/,
    "footnote": /data-footnotes/,
    "inline math": /class="math math-inline"/,
    "display math": /katex-display/,
    "numbered figure": /<figure class="labeled-figure" id="fig:disc"(?: data-line="\d+")?>/,
    "table caption": /<caption><strong>Table [\d.]+: Fruit sold per day\./,
    "listing": /<figure class="code-listing" id="lst:vowels"(?: data-line="\d+")?>/,
    "equation lines": /\([\d.]+a\)[\s\S]*\([\d.]+b\)/,
    "theorem": /Theorem [\d.]+ — Pythagoras/,
    "definition": /Definition [\d.]+ — Right triangle/,
    "algorithm": /class="algorithm-block"/,
    "score": /class="music-block"/,
    "diagram": /class="mermaid-block"/,
    "cross-reference": /<a href="#fig:disc" class="xref">Figure [\d.]+<\/a>/,
    "raw HTML as text": /This &lt;b&gt;is not bold&lt;\/b&gt;\./,
  };
  for (const [feature, re] of Object.entries(need)) assert.match(html, re, `missing in the rendered tutorial: ${feature}`);
  // The comment is written out in a code example (that is the lesson); outside code it must not show.
  assert.doesNotMatch(html.replace(/<figure class="code-listing"[\s\S]*?<\/figure>/g, ""), /This sentence is invisible/);
});

// Verifies REQ-317 (UC-43)
test("every example the tutorial tells the reader to type renders on its own, with no unresolved reference", () => {
  const list = examples(source);
  assert.ok(list.length >= 30, `only ${list.length} examples`);
  for (const example of list) {
    let html = "";
    assert.doesNotThrow(() => (html = render(example)), `does not render:\n${example}`);
    // A YAML header is data, not text: an example that is only a header shows nothing.
    if (!example.startsWith("---\n")) assert.ok(html.length > 0, `renders to nothing:\n${example}`);
    assert.equal(count(html, /color:red/g), 0, `has an unresolved reference:\n${example}`);
  }
});

// Verifies REQ-317 (UC-43)
test("the syntax of the README's 'Syntax extensions' list is taught in the tutorial", () => {
  const taught = ["{#fig:", "{#tab:", "{#lst:", "{#eq:", "{#sec:", "{#alg:", "{#mus:", "[@fig:", ":::theorem", "@cite(", "[!NOTE]", "==", "~Underlined~", "```alg", "```mus", "```mermaid", "H_{2}O", "mc^{2}", "@slide", "@end", "@note(", "@include(", "theme-color", "![", "[^"];
  for (const token of taught) assert.ok(source.includes(token), `the tutorial never shows ${token}`);
});

// Verifies REQ-317 (UC-43)
test("the tutorial doubles as a deck: a title slide and its @slide blocks build without an error", () => {
  const deck = t.state.api.buildSlideDeck(source, { maxHeadings: 99 });
  const errors = deck.diagnostics.filter((d: any) => d.severity === "error");
  assert.deepEqual(errors, []);
  assert.ok(deck.slides.some((s: any) => s.cover), "no title slide from the header");
  assert.ok(deck.slides.length >= 5, `only ${deck.slides.length} slides`);
});

// Verifies REQ-317 (UC-43)
test("the files the tutorial uses are next to it", () => {
  for (const f of ["circle.svg", "tutorial.bib"]) assert.ok(existsSync(join(dir, f)), f);
  assert.match(source, /bibliography: tutorial\.bib/);
});
