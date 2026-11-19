import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// The pipeline imports .tsx components, which Node cannot strip, so bundle once.
const here = dirname(fileURLToPath(import.meta.url));
let api: any;
let pipeline: any;
let ssr: any;
let cleanup = () => {};

before(async () => {
  // Inside the package so bare imports resolve to its node_modules.
  const out = mkdtempSync(join(here, ".build-"));
  cleanup = () => rmSync(out, { recursive: true, force: true });
  const common = { bundle: true, format: "esm" as const, platform: "node" as const, jsx: "automatic" as const, logLevel: "silent" as const,
    loader: { ".module.css": "local-css" as const, ".css": "empty" as const },
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" } };
  await build({ ...common, entryPoints: [join(here, "../slides/index.ts")], outfile: join(out, "slides.mjs") });
  await build({ ...common, entryPoints: [join(here, "../pipeline.ts")], outfile: join(out, "pipeline.mjs"), external: ["mermaid"] });
  // One bundle holding both the pipeline and react-dom/server, so components that use hooks see one React.
  await build({ ...common, stdin: { contents: 'export { renderMarkdown } from "./pipeline.ts"; export { renderToStaticMarkup } from "react-dom/server";', resolveDir: join(here, ".."), sourcefile: "ssr.ts" }, outfile: join(out, "ssr.mjs"), external: ["mermaid"] });
  ssr = await import(pathToFileURL(join(out, "ssr.mjs")).href);
  api = await import(pathToFileURL(join(out, "slides.mjs")).href);
  pipeline = await import(pathToFileURL(join(out, "pipeline.mjs")).href);
});

after(() => cleanup());

const codes = (ds: any[]) => ds.map((d) => d.code);

// Verifies REQ-033, REQ-044 (UC-34, UC-03)
test("directive syntax errors are fatal and located", () => {
  const cases: Array<[string, RegExp]> = [
    ["@slide(bogus)\nx\n@end", /unknown option "bogus"/],
    ["@slide (rtext)\nx\n@end", /no space/],
    ["x\n@end", /without a matching/],
    ["@slide\nx\n", /never closed/],
    ["@slide\n@slide\nx\n@end", /cannot nest/],
    ["@slide(rtext, 2col)\nx\n@end", /only one layout/],
    ["@slide[A @cite(k)]\nx\n@end", /@cite/],
    ["> @slide\nx\n@end", /beginning of its own line/],
  ];
  for (const [src, re] of cases) {
    const ds = api.checkSlides(src);
    assert.ok(ds.some((d: any) => d.code === "syntax" && re.test(d.message)), `${src} → ${JSON.stringify(ds)}`);
  }
  const ds = api.checkSlides("a\n\n@slide(bogus)\nx\n@end");
  assert.equal(ds.find((d: any) => d.code === "syntax").loc.line, 3);
});

// Verifies REQ-033, REQ-044 (UC-34, UC-03)
test("directives inside code fences are left alone", () => {
  const ds = api.checkSlides("```\n@slide(bogus)\n```\n");
  assert.deepEqual(ds, []);
});

// Verifies REQ-004 (UC-03)
test("document mode: wrappers are transparent, nodoc is removed", () => {
  const { renderToStaticMarkup } = createRequire(import.meta.url)("react-dom/server");
  const html = renderToStaticMarkup(
    pipeline.renderMarkdown("Before.\n\n@slide[Hidden title](nodoc)\nSecret.\n@end(lead-in text)\n\n@slide[Shown]\nVisible.\n@end(lead)\n\nAfter.\n")
  );
  assert.match(html, /Before\./);
  assert.match(html, /Visible\./);
  assert.match(html, /After\./);
  assert.doesNotMatch(html, /Secret/);
  assert.doesNotMatch(html, /Hidden title|Shown|lead-in text|lead/);
});

// Verifies REQ-004, REQ-033, REQ-044 (UC-03, UC-34)
test("document mode: a reference into a nodoc block is an error, and so is an unknown label", () => {
  const withNodoc = "See [@fig:a].\n\n@slide(nodoc)\n![Cap](a.png) {#fig:a}\n@end\n";
  assert.throws(() => pipeline.renderMarkdown(withNodoc), /nodoc/);
  assert.throws(() => pipeline.renderMarkdown("See [@fig:nope].\n\n@slide\nx\n@end\n"), /unknown label/);
  // Documents without directives keep their old lenient behavior.
  assert.doesNotThrow(() => pipeline.renderMarkdown("See [@fig:nope]."));
});

// Verifies REQ-005 (UC-03)
test("slide mode keeps only @slide content, with title resolution", () => {
  const deck = api.buildSlideDeck("# Intro\n\nProse that is pruned.\n\n@slide\nKept paragraph.\n@end\n\n@slide[Own title]\nSecond.\n@end\n\n@slide[]\nThird.\n@end\n");
  assert.equal(deck.slides.length, 3);
  assert.deepEqual(deck.slides.map((s: any) => s.titleSource), ["heading", "override", "override"]);
  assert.equal(deck.slides[2].title.length, 0);
  const text = JSON.stringify(deck.slides.map((s: any) => s.body));
  assert.doesNotMatch(text, /pruned/);
});

// Verifies REQ-005 (UC-03)
test("a blank-title block without a heading has titleSource none", () => {
  const deck = api.buildSlideDeck("@slide\nOnly.\n@end\n");
  assert.equal(deck.slides[0].titleSource, "none");
});

// Verifies REQ-011 (UC-03)
test("splitting is greedy, repeats the title, numbers continuations and puts the lead-in last", () => {
  const paras = Array.from({ length: 12 }, (_, i) => `Paragraph number ${i} has some text in it that takes a line or two to say.`).join("\n\n");
  const deck = api.buildSlideDeck(`# T\n\n@slide\n${paras}\n@end(The lead-in.)\n`);
  const n = deck.slides.length;
  assert.ok(n > 1, "expected a split");
  deck.slides.forEach((s: any, i: number) => {
    assert.equal(s.continuation.index, i + 1);
    assert.equal(s.continuation.of, n);
    assert.equal(s.titleSource, "heading");
    assert.equal(!!s.leadin, i === n - 1);
  });
  assert.ok(codes(deck.diagnostics).includes("split"));
});

// Verifies REQ-020 (UC-05)
test("a cross-reference unit is dropped when its target is on another slide", () => {
  const filler = Array.from({ length: 10 }, (_, i) => `Filler paragraph ${i} with enough words to occupy a good part of a line.`).join("\n\n");
  const src = `@slide\nBefore.\nThis sentence cites [@fig:a].\n\n${filler}\n\n![Cap](a.png) {#fig:a}\n@end\n`;
  const deck = api.buildSlideDeck(src);
  const text = JSON.stringify(deck.slides.map((s: any) => s.body));
  assert.ok(deck.slides.length > 1);
  assert.ok(!text.includes("This sentence cites"), "sentence should be dropped");
  assert.ok(text.includes("Before."));
  assert.ok(codes(deck.diagnostics).includes("drop-xref"));
  assert.ok(codes(deck.diagnostics).includes("drop-follows"));
});

// Verifies REQ-020 (UC-05)
test("a cross-reference unit survives when its target is on the same slide", () => {
  const deck = api.buildSlideDeck("@slide\nSee [@fig:a].\n\n![Cap](a.png) {#fig:a}\n@end\n");
  assert.equal(deck.slides.length, 1);
  assert.match(JSON.stringify(deck.slides[0].body), /fig:a/);
  assert.ok(!codes(deck.diagnostics).includes("drop-xref"));
});

// Verifies REQ-020 (UC-05)
test("a reference to a label in no @slide block is dropped early; noxrefs drops all", () => {
  const a = api.buildSlideDeck("![Cap](a.png) {#fig:a}\n\n@slide\nKeep this.\nDrop [@fig:a] this.\n@end\n");
  assert.doesNotMatch(JSON.stringify(a.slides[0].body), /Drop/);
  const b = api.buildSlideDeck("@slide(noxrefs)\nKeep this.\nDrop [@fig:a] this.\n\n![Cap](a.png) {#fig:a}\n@end\n");
  assert.doesNotMatch(JSON.stringify(b.slides[0].body), /Drop/);
  assert.match(JSON.stringify(b.slides[0].body), /Keep this/);
});

// Verifies REQ-005 (UC-03)
test("adjacent dividers merge into one nested agenda", () => {
  const src = "# Doc\n\n@slide\n## Part A\n@end\n\nIgnored prose.\n\n@slide\n### A1\n@end\n\n@slide\n## Part B\n@end\n\n@slide\nContent.\n@end\n";
  const deck = api.buildSlideDeck(src);
  assert.equal(deck.slides.length, 2);
  const agenda = deck.slides[0];
  assert.equal(agenda.divider, true);
  assert.equal(agenda.titleSource, "heading");
  assert.equal(agenda.body[0].type, "list");
  assert.equal(agenda.body[0].children.length, 2);
  assert.equal(agenda.body[0].children[0].children.at(-1).type, "list");
});

// Verifies REQ-005 (UC-03)
test("a title-only block is its own slide and never joins an agenda", () => {
  const deck = api.buildSlideDeck("@slide[divider 1]\n@end\n\n@slide\n# divider 2\n@end\n");
  assert.equal(deck.slides.length, 2);
  assert.equal(deck.slides[0].body[0].type, "heading");
  assert.equal(deck.slides[1].body[0].type, "heading");
  const around = api.buildSlideDeck("@slide\n## A\n@end\n\n@slide[Between]\n@end\n\n@slide\n## B\n@end\n");
  assert.equal(around.slides.length, 3);
});

// Verifies REQ-006 (UC-03)
test("layouts: rtext sends images to the image region, 2col with an image goes single", () => {
  const rtext = api.buildSlideDeck("@slide(rtext)\nText.\n\n![Cap](a.png)\n@end\n");
  assert.equal(rtext.slides[0].layout, "rtext");
  assert.equal(rtext.slides[0].images.length, 1);
  const noimg = api.buildSlideDeck("@slide(ltext)\nText only.\n@end\n");
  assert.equal(noimg.slides[0].layout, "single");
  assert.ok(codes(noimg.diagnostics).includes("layout-no-image"));
  const twocol = api.buildSlideDeck("@slide(2col)\nText.\n\n![Cap](a.png)\n@end\n");
  assert.equal(twocol.slides[0].layout, "single");
});

// Verifies REQ-013 (UC-28)
test("steplists numbers list items in order; stepleadin follows the last item", () => {
  const deck = api.buildSlideDeck("@slide(steplists, stepleadin)\n- one\n  - nested\n- two\n@end(Done.)\n");
  const s = deck.slides[0];
  assert.deepEqual(s.steps.map((x: string[]) => x.length), [0, 1, 1, 1, 1]);
  assert.equal(s.leadinStep, 4);
  const items = s.body[0].children;
  assert.equal(items[0].data.hProperties["data-step"], 1);
  assert.equal(items[0].children.at(-1).children[0].data.hProperties["data-step"], 2);
  assert.equal(items[1].data.hProperties["data-step"], 3);
});

// Verifies REQ-013 (UC-28)
test("step options with nothing to step are a no-op with a note", () => {
  const deck = api.buildSlideDeck("@slide(steplists, stepleadin)\n```\ncode\n```\n@end\n");
  assert.equal(codes(deck.diagnostics).filter((c: string) => c === "step-noop").length, 2);
});

// Verifies REQ-011 (UC-03)
test("a list continuation repeats the parent item", () => {
  const items = Array.from({ length: 14 }, (_, i) => `  - child item ${i} with a few words`).join("\n");
  const deck = api.buildSlideDeck(`@slide\n- parent item\n${items}\n@end\n`);
  assert.ok(deck.slides.length > 1);
  const second = deck.slides[1];
  assert.ok(second.context.some((c: any) => c.kind === "listParent" && c.continued));
  assert.match(JSON.stringify(second.body[0]), /parent item/);
});

// Verifies REQ-011 (UC-03)
test("a code listing or theorem that does not fit is left off the slide, with a hint, not an error", () => {
  const code = "```\n" + Array.from({ length: 80 }, (_, i) => `line ${i}`).join("\n") + "\n```";
  const thm = ":::thm Big\n" + Array.from({ length: 80 }, (_, i) => `Sentence ${i} of a theorem that is far too long.`).join("\n\n") + "\n:::";
  for (const big of [code, thm]) {
    const deck = api.buildSlideDeck(`@slide\nKept text.\n\n${big}\n\nMore kept text.\n@end\n`);
    const left = deck.diagnostics.filter((d: any) => d.code === "drop-float");
    assert.equal(left.length, 1);
    assert.equal(left[0].severity, "info");
    assert.ok(!deck.diagnostics.some((d: any) => d.severity === "error"), JSON.stringify(deck.diagnostics));
    const body = JSON.stringify(deck.slides.map((s: any) => s.body));
    assert.match(body, /Kept text/);
    assert.match(body, /More kept text/);
    assert.doesNotMatch(body, /line 40|Sentence 40/);
  }
});

// Verifies REQ-005 (UC-03)
test("when a title is shared by several slides, every one of them shows its counter", () => {
  const filler = Array.from({ length: 14 }, (_, i) => `Filler paragraph ${i} with enough words to occupy a good part of a line.`).join("\n\n");
  const deck = api.buildSlideDeck(`@slide[Shared]\n${filler}\n@end\n`);
  assert.ok(deck.slides.length > 1);
  const { renderToStaticMarkup } = createRequire(import.meta.url)("react-dom/server");
  const html = deck.slides.map((s: any) => renderToStaticMarkup(api.renderSlide(s, deck.render)));
  html.forEach((h: string, i: number) => assert.match(h, new RegExp(`\\(${i + 1}/${deck.slides.length}\\)`)));
});

// Verifies REQ-007, REQ-033, REQ-044 (UC-03, UC-34)
test("@include expands recursively, detects cycles and maps lines to files", () => {
  const files: Record<string, string> = {
    "main.md": "",
    "a.md": "A1\n@include(sub/b.md)\nA3",
    "sub/b.md": "B1\nB2",
    "loop.md": "@include(loop.md)",
  };
  const read = (p: string) => files[p] ?? null;
  const r = api.expandIncludes("Top\n@include(a.md)\nBottom", { file: "main.md", read });
  assert.equal(r.text, "Top\nA1\nB1\nB2\nA3\nBottom");
  assert.deepEqual(r.lineMap.map((l: any) => l.file ?? "main"), ["main", "a.md", "sub/b.md", "sub/b.md", "a.md", "main"]);
  const cyc = api.expandIncludes("@include(loop.md)", { file: "main.md", read });
  assert.ok(cyc.diagnostics.some((d: any) => /cycle/.test(d.message)));
  const missing = api.expandIncludes("@include(nope.md)", { file: "main.md", read });
  assert.ok(missing.diagnostics.some((d: any) => /cannot read/.test(d.message)));
});

// Verifies REQ-007, REQ-033, REQ-044 (UC-03, UC-34)
test("diagnostics from included text name the original file", () => {
  const files: Record<string, string> = { "bad.md": "@slide(bogus)\nx\n@end" };
  const r = api.expandIncludes("intro\n@include(bad.md)", { file: "main.md", read: (p: string) => files[p] ?? null });
  const ds = api.checkSlides(r.text, { sourceMap: r.lineMap });
  const err = ds.find((d: any) => d.code === "syntax");
  assert.equal(err.loc.file, "bad.md");
  assert.equal(err.loc.line, 1);
});

import { createRequire } from "node:module";

const html = (deck: any, i = 0) =>
  createRequire(import.meta.url)("react-dom/server").renderToStaticMarkup(api.renderSlide(deck.slides[i], deck.render));

// Verifies REQ-011 (UC-03)
test("at most one theorem, admonition, quote or listing per slide", () => {
  const src = "@slide\n> [!NOTE]\n> First.\n\n> Second quote.\n\n```js\ncode();\n```\n@end\n";
  const deck = api.buildSlideDeck(src);
  assert.equal(deck.slides.length, 3);
  for (const s of deck.slides) assert.equal(s.body.length, 1);
});

// Verifies REQ-011 (UC-03)
test("floats take the image region in rtext / ltext, like images", () => {
  const deck = api.buildSlideDeck("@slide(rtext)\nIntro text.\n\n:::thm Name\n$a$\n:::\n@end\n");
  assert.equal(deck.slides.length, 1);
  assert.equal(deck.slides[0].layout, "rtext");
  assert.equal(deck.slides[0].images[0].type, "fencedDiv");
  const twocol = api.buildSlideDeck("@slide(2col)\nText.\n\n```\nx\n```\n@end\n");
  assert.equal(twocol.slides[0].layout, "single");
});

// Verifies REQ-011 (UC-03)
test("a second float spills onto its own slide in rtext", () => {
  const deck = api.buildSlideDeck("@slide(rtext)\nText.\n\n> One.\n\n> Two.\n@end\n");
  assert.equal(deck.slides.length, 2);
  assert.equal(deck.slides[1].layout, "single", "alone on its slide it takes the whole width");
  assert.equal(deck.slides[1].body[0].type, "blockquote");
});

// Verifies REQ-019, REQ-020 (UC-05)
test("only referenced items are numbered; the rest keep just their caption", () => {
  const src = "@slide\nSee [@fig:b].\n\n![First caption](a.png) {#fig:a}\n\n![Second caption](b.png) {#fig:b}\n@end\n";
  const deck = api.buildSlideDeck(src);
  const out = deck.slides.map((_: any, i: number) => html(deck, i)).join("\n");
  assert.match(out, /Figure 1: Second caption/);
  assert.match(out, /First caption/);
  assert.doesNotMatch(out, /Figure 2/);
  assert.doesNotMatch(out, /Figure \d+: First caption/);
});

// Verifies REQ-039 (UC-03)
test("only footnotes defined inside the @slide block are shown, numbered per slide", () => {
  const src = "@slide\nClaim.[^a] Other.[^out]\n\n[^a]: Defined inside the block.\n[^unused]: Never cited.\n@end\n\nLater prose.\n\n[^out]: Defined outside the block.\n";
  const deck = api.buildSlideDeck(src);
  assert.equal(deck.slides.length, 1);
  assert.equal(deck.slides[0].body.length, 1, "definitions are not slide content");
  const out = html(deck);
  assert.match(out, /Defined inside the block/);
  assert.doesNotMatch(out, /Defined outside the block/);
  assert.doesNotMatch(out, /Never cited/);
  const warn = deck.diagnostics.filter((d: any) => d.code === "unknown-footnote");
  assert.equal(warn.length, 1);
  assert.match(warn[0].message, /out/);
});

// Verifies REQ-039 (UC-03)
test("footnote references are errors in a title or lead-in", () => {
  assert.ok(api.checkSlides("@slide[Title[^a\\]]\nx\n@end").some((d: any) => /footnote/.test(d.message)));
  assert.ok(api.checkSlides("@slide\nx\n@end(Lead[^a])").some((d: any) => /footnote/.test(d.message)));
});


// Verifies REQ-011 (UC-03)
test("tables are floats: one per slide, in the image region", () => {
  const t = "| a | b |\n| - | - |\n| 1 | 2 |";
  const two = api.buildSlideDeck(`@slide\n${t}\n\n${t}\n@end\n`);
  assert.equal(two.slides.length, 2);
  const beside = api.buildSlideDeck(`@slide(rtext)\nText.\n\n${t}\n@end\n`);
  assert.equal(beside.slides[0].layout, "rtext");
  assert.equal(beside.slides[0].images[0].type, "table");
});

// Verifies REQ-006 (UC-03)
test("rtext / ltext revert to one column when no text shares the slide", () => {
  const alone = api.buildSlideDeck("@slide(ltext)\n> Only a quote.\n@end\n");
  assert.equal(alone.slides[0].layout, "single");
  assert.equal(alone.slides[0].images.length, 0);
  assert.equal(alone.slides[0].body[0].type, "blockquote");
  const imgOnly = api.buildSlideDeck("@slide(rtext)\n![Cap](a.png)\n@end\n");
  assert.equal(imgOnly.slides[0].layout, "single");
});

// Verifies REQ-009, REQ-111 (UC-28, UC-14)
test("the YAML header makes a title slide", () => {
  const src = "---\ntitle: My Talk\nsubtitle: A subtitle\nauthors:\n  - name: Ada\n    affiliation: Lab\n  - name: Alan\n    affiliation: Lab\ndate: 2026-10-19\n---\n\n@slide\nBody.\n@end\n";
  const deck = api.buildSlideDeck(src);
  assert.equal(deck.slides.length, 2);
  const c = deck.slides[0].cover;
  assert.equal(c.title, "My Talk");
  assert.equal(c.subtitle, "A subtitle");
  assert.deepEqual(c.authors.map((a: any) => [a.name, a.affiliations]), [["Ada", [1]], ["Alan", [1]]]);
  assert.deepEqual(c.affiliations, ["Lab"]);
  assert.equal(c.date, "2026-10-19");
  const out = html(deck, 0);
  assert.match(out, /My Talk/);
  assert.match(out, /A subtitle/);
  assert.equal(api.buildSlideDeck("@slide\nNo header.\n@end\n").slides.length, 1);
});

// Verifies REQ-010 (UC-28)
test("a slide number is rendered when given", () => {
  const deck = api.buildSlideDeck("@slide\nHi.\n@end\n");
  const markup = createRequire(import.meta.url)("react-dom/server").renderToStaticMarkup(api.renderSlide(deck.slides[0], deck.render, { number: 7 }));
  assert.match(markup, /vfm-slide-number">7</);
});

// Verifies REQ-030, REQ-045 (UC-09, UC-32)
test("notes go with the slide holding the content before them, and only that slide", () => {
  const filler = Array.from({ length: 12 }, (_, i) => `Paragraph ${i} with a fair amount of text in it so that the slide fills up quickly.`);
  // note A after paragraph 0 (slide 1), note B after the last paragraph (last slide)
  const body = filler.map((p, i) => (i === 0 ? `${p}\n\n@note(Note A)` : i === filler.length - 1 ? `${p}\n\n@note(Note B)` : p)).join("\n\n");
  const deck = api.buildSlideDeck(`@slide\n${body}\n@end\n`);
  assert.ok(deck.slides.length > 1);
  const text = (s: any) => JSON.stringify(s.notes);
  assert.match(text(deck.slides[0]), /Note A/);
  assert.doesNotMatch(text(deck.slides[0]), /Note B/);
  assert.match(text(deck.slides.at(-1)), /Note B/);
  for (const s of deck.slides.slice(1, -1)) assert.equal(s.notes.length, 0);
});

// Verifies REQ-030, REQ-045 (UC-09, UC-32)
test("several notes in one block are combined in order, and a note before any content goes to the first slide", () => {
  const deck = api.buildSlideDeck("@slide\n@note(First)\nText.\n\n@note(Second)\n@note(Third, with (nested) parens)\n@end\n");
  assert.equal(deck.slides.length, 1);
  const inline = (n: any[]): string => n.map((x) => x.value ?? inline(x.children ?? [])).join("");
  assert.deepEqual(deck.slides[0].notes.map(inline), ["First", "Second", "Third, with (nested) parens"]);
});

// Verifies REQ-030, REQ-045 (UC-09, UC-32)
test("notes in the next block belong to that block's slides", () => {
  const deck = api.buildSlideDeck("@slide\nOne.\n@note(for one)\n@end\n\n@slide\nTwo.\n@note(for two)\n@end\n");
  assert.equal(deck.slides.length, 2);
  assert.match(JSON.stringify(deck.slides[0].notes), /for one/);
  assert.doesNotMatch(JSON.stringify(deck.slides[0].notes), /for two/);
  assert.match(JSON.stringify(deck.slides[1].notes), /for two/);
});

// Verifies REQ-030, REQ-045 (UC-09, UC-32)
test("a multi-line note keeps line numbers and is one note", () => {
  const deck = api.buildSlideDeck("@slide\nText.\n@note(line one\nline two)\n\nMore.\n@end\n");
  assert.equal(deck.slides[0].notes.length, 1);
  const bad = api.checkSlides("@slide\nText.\n@end\n\n@slide\nx\n@note(oops\n@end\n");
  assert.ok(bad.some((d: any) => d.code === "syntax"));
});

// Verifies REQ-030, REQ-045 (UC-09, UC-32)
test("a note never appears in the document, and outside a block it is plain text", () => {
  const out = createRequire(import.meta.url)("react-dom/server").renderToStaticMarkup(
    pipeline.renderMarkdown("Before.\n\n@slide\nIn slide.\n@note(secret)\n@end\n")
  );
  assert.doesNotMatch(out, /secret/);
  // Outside a block it is ordinary text.
  assert.deepEqual(api.checkSlides("@note(outside)\n"), []);
  const raw = createRequire(import.meta.url)("react-dom/server").renderToStaticMarkup(pipeline.renderMarkdown("Before @note(x) text.\n\n@note(whole line)\n"));
  assert.match(raw, /@note\(whole line\)/);
  assert.ok(api.checkSlides("@slide\n@note no parens\n@end").some((d: any) => /parentheses/.test(d.message)));
});

// Verifies REQ-030, REQ-045 (UC-09, UC-32)
test("notes on dividers are combined, and renderNotes leaves them out of the slide", () => {
  const deck = api.buildSlideDeck("@slide\n## A\n@note(a)\n@end\n\n@slide\n## B\n@note(b)\n@end\n");
  assert.equal(deck.slides.length, 1);
  assert.equal(deck.slides[0].notes.length, 2);
  const slideHtml = html(deck, 0);
  assert.doesNotMatch(slideHtml, />a</);
  const notes = createRequire(import.meta.url)("react-dom/server").renderToStaticMarkup(api.renderNotes(deck.slides[0], deck.render));
  assert.match(notes, /vfm-note/);
});

// ─── Backtick blocks (algorithm, music, mermaid) ───────────────────────────────

const renderHtml = (src: string) => ssr.renderToStaticMarkup(ssr.renderMarkdown(src));

// Verifies REQ-021 (UC-06)
test("algorithm, music and mermaid blocks are fenced code with a language", () => {
  const src = [
    "```alg Find the max {#alg:max}",
    "\\begin{algorithm}",
    "\\end{algorithm}",
    "```",
    "",
    "```mus Tune {#mus:t}",
    "X:1",
    "K:C",
    "CDEF|",
    "```",
    "",
    "~~~~mermaid Flow {#fig:flow}",
    "graph LR; A-->B",
    "```",
    "~~~~",
    "",
    "See [@alg:max], [@mus:t] and [@fig:flow].",
    "",
    "```python",
    "x = 1",
    "```",
  ].join("\n");
  const html = renderHtml(src);
  assert.match(html, /class="algorithm-caption"><span class="algorithm-number">Algorithm 1<\/span>: Find the max/);
  assert.match(html, /<music-abc|music-abc-container/);
  assert.match(html, /class="music-caption"><span class="music-number">Score 1<\/span>: Tune/);
  assert.match(html, /class="mermaid-caption"><span class="mermaid-number">Figure 1<\/span>: Flow/);
  // The longer fence kept its inner ``` line as diagram text.
  assert.match(html, /graph LR; A--&gt;B\n```/);
  assert.match(html, /Algorithm 1/);
  assert.match(html, /language-python/);
  assert.doesNotMatch(html, /__(algorithm|music|mermaid)-block/);
});

// Verifies REQ-021 (UC-06)
test("the old @@@ and &&& delimiters are no longer special", () => {
  const html = renderHtml("@@@\nplain\n@@@\n");
  assert.doesNotMatch(html, /algorithm-block/);
});

// Verifies REQ-021 (UC-06)
test("preprocessing keeps line numbers: a node after a block reports its true line", () => {
  const src = "```mus\nX:1\nK:C\nCDEF|\n```\n\n:::thm T\ninner\nlines\n:::\n\nTarget paragraph.\n";
  const { tree } = pipeline.parseForSlides(src);
  const para = tree.children.find((n: any) => n.type === "paragraph");
  assert.equal(para.position.start.line, 12);
  const div = tree.children.find((n: any) => n.type === "fencedDiv");
  assert.equal(div.children[0].position.start.line, 8);
});

// Verifies REQ-008 (UC-03)
test("a document separator inside a @slide block starts a new slide and is not shown", () => {
  const deck = api.buildSlideDeck("@slide[T]\nFirst.\n\n---\n\nSecond.\n\n***\n\n***\n\nThird.\n@end\n");
  assert.equal(deck.slides.length, 3);
  const text = deck.slides.map((s: any) => JSON.stringify(s.body));
  assert.match(text[0], /First/);
  assert.match(text[1], /Second/);
  assert.match(text[2], /Third/);
  assert.ok(!text.join("").includes("thematicBreak"));
});

// ─── Paragraph reducer ────────────────────────────────────────────────────────

/** The bullets (or text) a deck shows, flattened to strings; bold marked with ** **. */
function shown(deck: any): string[] {
  const text = (n: any): string =>
    typeof n.value === "string" ? n.value : n.type === "strong" ? `**${(n.children ?? []).map(text).join("")}**` : (n.children ?? []).map(text).join("");
  const out: string[] = [];
  const walk = (n: any, prefix = "") => {
    if (n.type === "list") n.children.forEach((c: any, i: number) => walk(c, n.ordered ? `${i + 1}. ` : ""));
    else if (n.type === "listItem") {
      out.push(prefix + (n.children as any[]).filter((c) => c.type !== "list").map(text).join(""));
      for (const sub of (n.children as any[]).filter((c) => c.type === "list")) {
        const before = out.length;
        walk(sub);
        for (let i = before; i < out.length; i++) out[i] = "  " + out[i];
      }
    }
    else if (n.data?.hProperties?.className?.includes("vfm-callout")) out.push(`CALLOUT ${text(n.children[0])} | ${text(n.children[1])}`);
    else if (n.type === "paragraph") out.push(text(n));
  };
  for (const slide of deck.slides) for (const b of slide.body) walk(b);
  return out;
}
const slideText = (body: string, front = "") => shown(api.buildSlideDeck(`${front}@slide\n${body}\n@end\n`));

// Verifies REQ-015 (UC-12)
test("sentences end at terminal punctuation plus a newline, with no abbreviation rules", () => {
  assert.deepEqual(slideText("The study was led by Dr. Chen at the university.\nResults came out in 2021.\nA follow-up is planned.", "---\nparagraphs: full\n---\n"),
    ["The study was led by Dr. Chen at the university. Results came out in 2021. A follow-up is planned."]);
  // One line is one sentence however many full stops it holds.
  assert.deepEqual(slideText("It ended. So did this. Fine."), ["It ended. So did this. Fine."]);
});

// Verifies REQ-014 (UC-12)
test("reducer: a bold sentence is picked, bold is kept, brackets go", () => {
  const out = slideText("Retention improved sharply this year.\n**Repeat purchases rose 18%** after the loyalty program launched (see the appendix for methodology).\nThe team also redesigned the onboarding emails, which had been unchanged for years.\nSupport tickets were flat.");
  assert.deepEqual(out, ["Retention improved sharply this year.", "**Repeat purchases rose 18%** after the loyalty program launched."]);
});

// Verifies REQ-014 (UC-12)
test("reducer: a list after a colon becomes bullets", () => {
  // The intro stays as the parent bullet, so the list keeps its context.
  assert.deepEqual(slideText("The platform supports several export formats: PDF, HTML, PowerPoint, and plain text."),
    ["The platform supports several export formats:", "  PDF", "  HTML", "  PowerPoint", "  plain text"]);
});

// Verifies REQ-014 (UC-12)
test("reducer: a lone statistic becomes a callout", () => {
  assert.deepEqual(slideText("Customer churn fell to 4.2% in the third quarter after the pricing change."),
    ["CALLOUT **4.2%** | Customer churn fell in the third quarter after the pricing change."]);
});

// Verifies REQ-014 (UC-12)
test("reducer: asides between commas and in brackets are removed", () => {
  assert.deepEqual(slideText("The pilot, which ran in three regions over six months, exceeded its targets (see Table 2)."), ["The pilot exceeded its targets."]);
  // A list of short items is not an aside.
  assert.deepEqual(slideText("We bought apples, oranges, and pears today."), ["We bought apples, oranges, and pears today."]);
});

// Verifies REQ-014 (UC-12)
test("reducer: bold-only paragraph is verbatim, lead-ins go, ordinals make a numbered list", () => {
  assert.deepEqual(slideText("**Our priority this year is retention, not acquisition.**\n\nAcquisition costs have risen steadily.\nRetention has become the cheaper way to grow."),
    ["**Our priority this year is retention, not acquisition.**", "Acquisition costs have risen steadily.", "Retention has become the cheaper way to grow."]);
  assert.deepEqual(slideText("Revenue grew.\nMoreover, repeat purchases rose 18% after the launch."), ["Revenue grew.", "Repeat purchases rose 18% after the launch."]);
  assert.deepEqual(slideText("First, export the data from the old system.\nSecond, clean up duplicate records.\nThird, import the file into the new system."),
    ["1. Export the data from the old system.", "2. Clean up duplicate records.", "3. Import the file into the new system."]);
});

// Verifies REQ-030, REQ-045 (UC-09, UC-32)
test("reducer: a long paragraph is split by topic; modes first-sentence, notes-only and full", () => {
  const long = "Our first office opened in 2009 with four employees.\nGrowth was slow at first.\nBy 2014 we had moved to a larger building.\nHiring accelerated after that move.\nThe second half of this document turns to our product roadmap.\nThe roadmap is organized around three themes.\nEach theme has a named owner who reports quarterly.";
  const auto = slideText(long);
  assert.ok(auto.length >= 3 && auto.length <= 4, JSON.stringify(auto));
  assert.deepEqual(slideText(long, "---\nparagraphs: first-sentence\n---\n"), ["Our first office opened in 2009 with four employees."]);
  assert.deepEqual(slideText(long, "---\nparagraphs: notes-only\n---\n"), []);
  assert.equal(slideText(long, "---\nparagraphs: full\n---\n").length, 1);
  const bad = api.buildSlideDeck("---\nparagraphs: bogus\n---\n@slide\nHi.\n@end\n");
  assert.ok(bad.diagnostics.some((d: any) => d.code === "paragraph-mode"));
});

// Verifies REQ-014 (UC-12)
test("reducer output is always made of the paragraph's own words", () => {
  const src = "Alpha beta gamma delta.\nEpsilon zeta eta theta (iota kappa).\nLambda mu, nu xi omicron, pi rho sigma.\nTau upsilon: phi, chi, psi.";
  const words = new Set(src.toLowerCase().match(/\p{L}+/gu));
  for (const line of slideText(src)) for (const w of line.toLowerCase().match(/\p{L}+/gu) ?? []) assert.ok(words.has(w), w);
});

// Verifies REQ-024, REQ-043 (UC-31)
test("block elements carry data-line, the line in the author's file (header and blocks included)", () => {
  const src = "---\ntitle: T\n---\n\n# Head\n\n```alg Cap\nbody\nmore\n```\n\n- [ ] task\n- [x] done\n\nLast para.\n";
  const html = renderHtml(src);
  assert.match(html, /<h1[^>]*data-line="5"/);
  assert.match(html, /<div[^>]*algorithm-block[^>]*data-line="7"|data-line="7"[^>]*algorithm-block/);
  assert.match(html, /<li[^>]*data-line="12"/);
  assert.match(html, /<li[^>]*data-line="13"/);
  assert.match(html, /<p[^>]*data-line="15"[^>]*>Last para/);
});

// Verifies REQ-014 (UC-12)
test("language defaults to English; another language gets no English rules", () => {
  const src = "Revenue grew.\nMoreover, repeat purchases rose.";
  assert.deepEqual(slideText(src), ["Revenue grew.", "Repeat purchases rose."]);
  assert.deepEqual(slideText(src, "---\nlang: xx\n---\n"), ["Revenue grew.", "Moreover, repeat purchases rose."]);
});

// Verifies REQ-014 (UC-12)
test("a paragraph ending in a colon takes the list that follows it as its children", () => {
  assert.deepEqual(slideText("The weights are as follows:\n\n- first: 2\n- bold: 2"), ["The weights are as follows:", "  first: 2", "  bold: 2"]);
});

// Verifies REQ-014 (UC-12)
test("a bold value with no leading word keeps its whole sentence as the caption", () => {
  assert.deepEqual(slideText("The reducer was rated useful in **82%** of cases."), ["CALLOUT **82%** | The reducer was rated useful in **82%** of cases."]);
});

// Verifies REQ-022 (UC-03)
test("HTML comments never reach a slide", () => {
  const deck = api.buildSlideDeck("@slide\n<!-- a note to self -->\nKept.\n@end\n");
  assert.ok(!JSON.stringify(deck.slides.map((s: any) => s.body)).includes("note to self"));
});

// Verifies REQ-011 (UC-03)
test("a reduced paragraph stays on one slide when it fits", () => {
  const filler = Array.from({ length: 7 }, (_, i) => `Filler paragraph ${i} with enough words to occupy a good part of a line.`).join("\n\n");
  const deck = api.buildSlideDeck(`@slide\n${filler}\n\nFirst kept sentence of the pair.\nSecond kept sentence of the pair.\n@end\n`);
  const holding = deck.slides.filter((s: any) => JSON.stringify(s.body).includes("pair."));
  assert.equal(holding.length, 1);
});

// Verifies REQ-005 (UC-03)
test("a block with several sections that spans slides takes each slide's title from its heading", () => {
  const section = (name: string) => `## ${name}\n\n` + Array.from({ length: 14 }, (_, i) => `${name} paragraph ${i} with enough words to occupy a good part of a line.`).join("\n\n");
  const deck = api.buildSlideDeck(`@slide\n${section("Alpha")}\n\n${section("Beta")}\n@end\n`);
  const title = (s: any) => JSON.stringify(s.title);
  assert.ok(deck.slides.length >= 3, `${deck.slides.length} slides`);
  const alpha = deck.slides.filter((s: any) => title(s).includes("Alpha"));
  const beta = deck.slides.filter((s: any) => title(s).includes("Beta"));
  assert.ok(alpha.length >= 1 && beta.length >= 1);
  assert.equal(alpha.length + beta.length, deck.slides.length);
  // The heading became the title, so the body does not start with it again.
  for (const sl of deck.slides) assert.notEqual(sl.body[0]?.type, "heading");
  assert.deepEqual(alpha.map((s: any) => s.continuation.index), alpha.map((_: any, i: number) => i + 1));
  assert.ok(alpha.every((s: any) => s.continuation.of === alpha.length));
  assert.equal(alpha[0].titleSource, "heading");
});

// Verifies REQ-005 (UC-03)
test("a [title] on the block is kept; a block that fits on one slide keeps its heading in effect", () => {
  const withTitle = api.buildSlideDeck("@slide[Mine]\n## A\n\nText.\n\n## B\n\nMore.\n@end\n");
  assert.equal(withTitle.slides[0].titleSource, "override");
  const fits = api.buildSlideDeck("# Results\n\n@slide\n## A\n\nText.\n\n## B\n\nMore.\n@end\n");
  assert.equal(fits.slides.length, 1);
  assert.match(JSON.stringify(fits.slides[0].title), /Results/);
  const noHeading = api.buildSlideDeck("@slide\n## Only\n\nText here.\n@end\n");
  assert.match(JSON.stringify(noHeading.slides[0].title), /Only/);
});

// Verifies REQ-019, REQ-020 (UC-05)
test("numberCaptions: referenced numbers only what a cross-reference points to, without gaps", () => {
  const src = "![One](a.png) {#fig:a}\n\n![Two](b.png) {#fig:b}\n\n![Three](c.png) {#fig:c}\n\nSee [@fig:c] and [@fig:a].\n";
  const all = renderHtml(src);
  assert.match(all, /Figure 1/);
  assert.match(all, /Figure 2/);
  assert.match(all, /Figure 3/);
  const html = ssr.renderToStaticMarkup(ssr.renderMarkdown(src, { numberCaptions: "referenced" }));
  assert.match(html, /Figure 1/);
  assert.match(html, /Figure 2/);
  assert.doesNotMatch(html, /Figure 3/);
  // Captions stay; only the number goes, and the unreferenced one is the one without it.
  assert.match(html, /Two/);
  // Numbers follow the figures' order in the document: a is 1, c is 2.
  assert.match(html, /See <a[^>]*>Figure 2<\/a> and <a[^>]*>Figure 1<\/a>/);
});

// Verifies REQ-005 (UC-03)
test("a series of same-level headings with no content between them still becomes a bulleted list", () => {
  // Blocks holding only headings are merged into one list slide (an agenda), at any depth.
  const deck = api.buildSlideDeck("@slide\n## One\n@end\n\n@slide\n## Two\n@end\n\n@slide\n## Three\n@end\n\n@slide\nContent.\n@end\n");
  assert.equal(deck.slides.length, 2);
  assert.equal(deck.slides[0].divider, true);
  assert.equal(deck.slides[0].body[0].type, "list");
  assert.equal(deck.slides[0].body[0].children.length, 3);
  // Inside one block too: sibling headings are kept as headings in the body, not turned into a title.
  const one = api.buildSlideDeck("@slide\n## One\n\n## Two\n\n## Three\n\nText.\n@end\n");
  const body = JSON.stringify(one.slides[0].body);
  for (const name of ["One", "Two", "Three"]) assert.match(body, new RegExp(name));
  assert.equal(one.slides[0].titleSource, "none");
});

// Verifies REQ-005 (UC-03)
test("one block holding only a run of same-level headings is a bulleted list slide", () => {
  const deck = api.buildSlideDeck("@slide\n## A\n## B\n## C\n@end\n");
  assert.equal(deck.slides.length, 1);
  assert.equal(deck.slides[0].body[0].type, "list");
  assert.equal(deck.slides[0].body[0].children.length, 3);
});

// Verifies REQ-014 (UC-12)
test("reducer: only asides that open like one are cut between commas; digit separators are not commas", () => {
  const long = "Over the course of the last decade, open access journals have grown across publishers, regions and disciplines.";
  assert.deepEqual(slideText(long), [long]);
  const nums = "In 2008, about 1,200,000 articles were published, and most were open access.";
  assert.deepEqual(slideText(nums), [nums]);
});

// Verifies REQ-020 (UC-05)
test("a heading survives when the sentence after it is dropped for a cross-reference", () => {
  // The figure is in no @slide block, so the sentence citing it is dropped; its heading must stay.
  const deck = api.buildSlideDeck("![Cap](a.png) {#fig:a}\n\n@slide\n# Results\n\nSee [@fig:a] for the data.\nThe second sentence stays.\n@end\n");
  assert.equal(deck.slides.length, 1);
  assert.match(JSON.stringify(deck.slides[0].title), /Results/);
  assert.match(JSON.stringify(deck.slides[0].body), /second sentence stays/);
  assert.doesNotMatch(JSON.stringify(deck.slides[0].body), /for the data/);
});

// ─── Underline: single tilde ──────────────────────────────────────────────────

// Verifies REQ-040 (UC-29)
test("~text~ is underlined, ~~text~~ is still struck through, and stray tildes stay literal", () => {
  const html = renderHtml("An ~underlined phrase~ and ~~struck~~ text, with ~**bold** inside~ too.");
  assert.match(html, /<u>underlined phrase<\/u>/);
  assert.match(html, /<del>struck<\/del>/);
  assert.match(html, /<u><strong>bold<\/strong> inside<\/u>/);
  // Not pairs: space inside the tildes, an escape, a lone tilde, code.
  for (const src of ["about ~5 to ~10 items", "an \\~escaped\\~ pair", "one ~ alone", "`~code~` here", "~ not~ nor ~this ~"]) {
    assert.doesNotMatch(renderHtml(src), /<u>/, src);
  }
  assert.match(renderHtml("`~code~` here"), /<code>~code~<\/code>/);
});

// Verifies REQ-040 (UC-29)
test("underline works inside fenced divs, headings and list items", () => {
  const html = renderHtml("# A ~title~\n\n- an ~item~\n\n:::thm T\nInside ~the div~.\n:::\n");
  assert.equal((html.match(/<u>/g) ?? []).length, 3);
});

// Verifies REQ-014 (UC-12)
test("reducer: the main clause of 'While A, B' is the bullet; lists and bold are left alone", () => {
  assert.deepEqual(
    slideText("While the majority of journals charge authors nothing, article-processing charges have become common at the largest publishers."),
    ["Article-processing charges have become common at the largest publishers."]
  );
  assert.deepEqual(slideText("Although the sample was small, the effect was large and consistent across all of the regions."), ["The effect was large and consistent across all of the regions."]);
  assert.deepEqual(slideText("Despite a slow start, growth accelerated after 2005 in every region."), ["Growth accelerated after 2005 in every region."]);
  // A list inside the background clause: the first comma is not the clause boundary.
  const list = "While apples, pears, and plums all grew, the harvest of cherries fell sharply this year.";
  assert.deepEqual(slideText(list), [list]);
  // Bold text is never removed with the cut part; too little left means no cut.
  const bold = "While **the key result** held, the details were disputed by several of the reviewers.";
  assert.deepEqual(slideText(bold), [bold]);
  const short = "Although it rained, we left.";
  assert.deepEqual(slideText(short), [short]);
  // Another language gets none of it.
  assert.deepEqual(slideText("While the majority charge nothing, fees have become common among the largest publishers.", "---\nlang: xx\n---\n"),
    ["While the majority charge nothing, fees have become common among the largest publishers."]);
});

// Verifies REQ-014 (UC-12)
test("reducer: the main clause is found even when the background clause holds italics", () => {
  assert.deepEqual(
    slideText("Though it could be argued that *PLOS ONE* is a general science journal, the vast majority of its articles are in biomedicine."),
    ["The vast majority of its articles are in biomedicine."]
  );
});

// Verifies REQ-012, REQ-011 (UC-03)
test("a table taller than a slide continues on following slides with its header repeated", () => {
  const rows = Array.from({ length: 80 }, (_, i) => `| row ${i} | x${i} |`).join("\n");
  const deck = api.buildSlideDeck(`@slide[Big]\n| name | value |\n| - | - |\n${rows}\n@end\n`);
  const tables = deck.slides.flatMap((s: any) => s.body.filter((b: any) => b.type === "table"));
  assert.ok(tables.length > 1, `${tables.length} tables`);
  assert.ok(!deck.diagnostics.some((d: any) => d.severity === "error"), JSON.stringify(deck.diagnostics));
  assert.ok(deck.diagnostics.some((d: any) => d.code === "table-split"));
  const cellText = (c: any) => JSON.stringify(c);
  for (const t of tables) assert.match(cellText(t.children[0]), /name/); // header on every slide
  // Every row appears exactly once, in order.
  const seen = tables.flatMap((t: any) => t.children.slice(1).map((r: any) => /row (\d+)/.exec(cellText(r))![1]));
  assert.deepEqual(seen, Array.from({ length: 80 }, (_, i) => String(i)));
});

// Verifies REQ-011 (UC-03)
test("a table with no header row that does not fit is left off; so is any other float", () => {
  const rows = Array.from({ length: 80 }, (_, i) => `| row ${i} | x${i} |`).join("\n");
  const noHeader = api.buildSlideDeck(`@slide\nKept.\n\n| | |\n| - | - |\n${rows}\n@end\n`);
  assert.equal(noHeader.slides.flatMap((s: any) => s.body.filter((b: any) => b.type === "table")).length, 0);
  assert.ok(noHeader.diagnostics.some((d: any) => d.code === "drop-float" && d.severity === "info"));
  assert.ok(!noHeader.diagnostics.some((d: any) => d.severity === "error"));
  // Any other float (here a blockquote; the real measurer does the same for images, algorithms, scores, diagrams).
  const quote = Array.from({ length: 80 }, (_, i) => `> Quoted line number ${i} that goes on a little.`).join(">\n");
  const deck = api.buildSlideDeck(`@slide\nKept.\n\n${quote}\n@end\n`);
  assert.ok(deck.diagnostics.some((d: any) => d.code === "drop-float"), JSON.stringify(deck.diagnostics));
  assert.ok(!deck.diagnostics.some((d: any) => d.severity === "error"));
});

// Verifies REQ-011 (UC-03)
test("a single sentence taller than a slide is still an overflow error", () => {
  const sentence = Array.from({ length: 4000 }, (_, i) => `word${i}`).join(" ") + ".";
  const deck = api.buildSlideDeck(`@slide\n${sentence}\n@end\n`);
  assert.ok(deck.diagnostics.some((d: any) => d.code === "overflow" && d.severity === "error"));
});

// Verifies REQ-022 (UC-03)
test("raw HTML is not part of the flavor: it shows as text; comments stay invisible", () => {
  const html = renderHtml("A <sup>a</sup> note and <br> a break.\n\n<div>block</div>\n\n<!-- hidden -->\n\n:::thm T\nInside <b>div</b>.\n:::\n");
  assert.doesNotMatch(html, /<sup>|<br|<div>block|<b>/);
  assert.match(html, /&lt;sup&gt;a&lt;\/sup&gt;/);
  assert.match(html, /&lt;div&gt;block&lt;\/div&gt;/);
  assert.match(html, /Inside &lt;b&gt;div&lt;\/b&gt;/);
  assert.doesNotMatch(html, /hidden/); // comments are not shown
});

// Verifies REQ-022 (UC-03)
test("raw HTML shows as text on slides too", () => {
  const deck = api.buildSlideDeck("@slide\nA table note <sup>a</sup> here.\n@end\n");
  const values: string[] = [];
  const collect = (n: any) => { if (typeof n.value === "string") values.push(n.value); (n.children ?? []).forEach(collect); };
  deck.slides[0].body.forEach(collect);
  assert.equal(values.join(""), "A table note <sup>a</sup> here.");
  assert.doesNotMatch(JSON.stringify(deck.slides[0].body), /"type":"html"/);
});

// Verifies REQ-014 (UC-12)
test("reducer: citations and cross-references survive even inside brackets, parentheses and asides", () => {
  for (const src of [
    "Prior work (@cite(smith2020)) found the effect.",
    "Prior work found the effect (see @cite(smith2020)).",
    "Prior work [@cite(smith2020)] found the effect.",
    "The pilot, which ran in three regions @cite(smith2020), exceeded its targets.",
    "Growth continued — see @cite(smith2020) for the details — in every region.",
  ]) {
    const out = slideText(src).join(" ");
    assert.match(out, /@cite\(smith2020\)/, `${src} → ${out}`);
  }
  const withFigure = api.buildSlideDeck("@slide\nThe result (see [@fig:a]) is clear in every region.\n\n![Cap](a.png) {#fig:a}\n@end\n");
  assert.match(JSON.stringify(withFigure.slides.map((x: any) => x.body)), /\[@fig:a\]/);
  // Ordinary brackets still go.
  assert.deepEqual(slideText("Prior work found the effect (see the appendix)."), ["Prior work found the effect."]);
});

// Verifies REQ-014 (UC-12)
test("reducer: a citation in the background clause keeps the sentence whole", () => {
  const src = "While earlier work @cite(smith2020) disagreed, the effect was large and consistent across all of the regions.";
  assert.deepEqual(slideText(src), [src]);
});
