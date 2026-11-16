/**
 * Tests for the `slide-polish` feature. Each test names the requirements (REQUIREMENTS.md in
 * vfm-preview/docs) and use cases (USE_CASES.md) that it verifies.
 *
 * These do not depend on a particular release of the slide builder's internals, so they live in tests/
 * (the older suites in test/ are still run by `npm test`).
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { parseThemeColor } from "../slides/themeColor.ts";
import { isVideoUrl } from "../plugins/video-url.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
let api: any;
let ssr: any;
let cleanup = () => {};

before(async () => {
  const out = mkdtempSync(join(here, ".build-"));
  cleanup = () => rmSync(out, { recursive: true, force: true });
  const common = {
    bundle: true,
    format: "esm" as const,
    platform: "node" as const,
    jsx: "automatic" as const,
    logLevel: "silent" as const,
    loader: { ".module.css": "local-css" as const, ".css": "empty" as const },
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
    external: ["mermaid"],
  };
  await build({ ...common, entryPoints: [join(root, "slides/index.ts")], outfile: join(out, "slides.mjs") });
  await build({
    ...common,
    stdin: { contents: 'export { renderMarkdown } from "./pipeline.ts"; export { renderToStaticMarkup } from "react-dom/server";', resolveDir: root, sourcefile: "ssr.ts" },
    outfile: join(out, "ssr.mjs"),
  });
  api = await import(pathToFileURL(join(out, "slides.mjs")).href);
  ssr = await import(pathToFileURL(join(out, "ssr.mjs")).href);
});

after(() => cleanup());

const slideHtml = (deck: any, i = 0) => ssr.renderToStaticMarkup(api.renderSlide(deck.slides[i], deck.render));
const docHtml = (md: string) => ssr.renderToStaticMarkup(ssr.renderMarkdown(md));
const css = (file: string) => readFileSync(join(root, file), "utf8");
const header = (extra = "") => `---\ntitle: T\n${extra}---\n\n`;

// ─── Theme color ──────────────────────────────────────────────────────────────

// Verifies REQ-101, REQ-102, REQ-105 (UC-13)
test("theme-color sets the accent on every slide and tints only the title and section slides", () => {
  const deck = api.buildSlideDeck(`${header('theme-color: "#1a6ea8"\n')}@slide[Section]\n@end\n\n@slide[Body]\nText.\n@end\n`);
  assert.equal(deck.slides.length, 3);
  const [cover, section, body] = [0, 1, 2].map((i) => slideHtml(deck, i));
  for (const h of [cover, section, body]) assert.match(h, /style="--vfm-slide-accent:#1a6ea8"/);
  assert.match(cover, /class="vfm-slide vfm-cover vfm-tinted"/);
  assert.match(section, /vfm-divider vfm-tinted/);
  assert.doesNotMatch(body, /vfm-tinted/);
});

// Verifies REQ-105 (UC-13)
test("without theme-color the slides carry no color style and no tint", () => {
  const deck = api.buildSlideDeck(`${header()}@slide[Section]\n@end\n\n@slide[Body]\nText.\n@end\n`);
  for (let i = 0; i < deck.slides.length; i++) {
    const h = slideHtml(deck, i);
    assert.doesNotMatch(h, /--vfm-slide-accent/);
    assert.doesNotMatch(h, /vfm-tinted/);
  }
  assert.equal(deck.diagnostics.filter((d: any) => d.code === "theme-color").length, 0);
});

// Verifies REQ-101, REQ-102 (UC-13), by inspection of the stylesheet
test("the stylesheet draws the title rule from the accent and mixes it 14% into white for tinted slides", () => {
  const sheet = css("slides/slides.css");
  assert.match(sheet, /\.vfm-slide-title \{[^}]*border-bottom: 3px solid var\(--vfm-slide-rule, var\(--_accent\)\)/s);
  assert.match(sheet, /--_accent: var\(--vfm-slide-accent,/);
  assert.match(sheet, /\.vfm-slide\.vfm-tinted[^{]*\{[^}]*--_bg: color-mix\(in srgb, var\(--vfm-slide-accent\) 14%, #ffffff\)/s);
  assert.match(sheet, /\.vfm-slide\.vfm-tinted[^{]*\{[^}]*--_fg: #1f2328/s);
});

// Verifies REQ-103 (UC-13)
test("parseThemeColor accepts the listed forms and nothing else", () => {
  for (const ok of ["#abc", "#1A6EA8", "rgb(1, 2, 3)", "rgb(255,255,255)", "hsl(205, 73%, 38%)", "teal", "RebeccaPurple"]) {
    assert.ok(parseThemeColor(ok), ok);
  }
  for (const bad of ["", "#abcd", "#12345", "rgb(256, 0, 0)", "hsl(400, 10%, 10%)", "notacolor", "red; background: url(x)", "red\" onload=\"x", "var(--x)", "url(x)", "expression(1)"]) {
    assert.equal(parseThemeColor(bad), undefined, bad);
  }
  assert.equal(parseThemeColor("#ABC"), "#abc");
});

// Verifies REQ-104 (UC-13, UC-11)
test("an invalid theme-color is reported at its header line and the defaults are used", () => {
  const deck = api.buildSlideDeck(`---\ntitle: T\ntheme-color: "fuchsia; x"\n---\n\n@slide\nText.\n@end\n`);
  const d = deck.diagnostics.find((x: any) => x.code === "theme-color");
  assert.ok(d);
  assert.equal(d.loc.line, 3);
  assert.doesNotMatch(slideHtml(deck, 0), /--vfm-slide-accent/);
});

// Verifies REQ-106 (UC-13), by inspection: the export bundles the same renderer, which writes the style inline
test("the accent is inline on the slide element, so the HTML export carries it with the page", () => {
  const deck = api.buildSlideDeck(`${header("theme-color: teal\n")}@slide\nText.\n@end\n`);
  assert.match(slideHtml(deck, 1), /style="--vfm-slide-accent:teal"/);
});

// ─── Affiliations ────────────────────────────────────────────────────────────

// Verifies REQ-111, REQ-112 (UC-14)
test("the title slide lists numbered affiliations and marks each author", () => {
  const deck = api.buildSlideDeck(
    "---\ntitle: T\nauthor:\n  - name: Ada\n    affiliation: Lab A, London, UK\n  - name: Bo\n    affiliation: [Lab A, London, UK, Lab B]\n---\n\n@slide\nText.\n@end\n"
  );
  const c = deck.slides[0].cover;
  assert.ok(c.affiliations.length >= 1);
  assert.equal(c.numbered, true);
  const h = slideHtml(deck, 0);
  assert.match(h, /vfm-cover-affiliations/);
  assert.match(h, /Lab A/);
  assert.match(h, /<sup>1<\/sup>/);
});

// Verifies REQ-113 (UC-14)
test("an affiliation may be named by institution or organization", () => {
  const deck = api.buildSlideDeck(
    "---\ntitle: T\nauthor:\n  - name: Ada\n    affiliation: { institution: Uni X, city: Paris }\n  - name: Bo\n    affiliation: { organization: Corp Y }\n---\n\n@slide\nText.\n@end\n"
  );
  assert.deepEqual([...deck.slides[0].cover.affiliations].sort(), ["Corp Y", "Uni X, Paris"]);
  const h = slideHtml(deck, 0);
  assert.match(h, /Uni X/);
  assert.match(h, /Corp Y/);
});

// Verifies REQ-114 (UC-14)
test("top-level affiliations that no author refers to are listed once, without numbers", () => {
  const deck = api.buildSlideDeck(
    "---\ntitle: T\nauthors: [Ada, Bo]\naffiliations:\n  - id: a\n    name: Institute Z\n    city: Rome\n---\n\n@slide\nText.\n@end\n"
  );
  const c = deck.slides[0].cover;
  assert.deepEqual(c.affiliations, ["Institute Z, Rome"]);
  assert.equal(c.numbered, false);
  const h = slideHtml(deck, 0);
  assert.match(h, /Institute Z, Rome/);
  assert.doesNotMatch(h, /<li><sup>/);
});

// ─── Math in captions ────────────────────────────────────────────────────────

// Verifies REQ-121 (UC-15)
test("captions of figures, tables, listings, algorithms, scores and diagrams render $math$", () => {
  const md = [
    "![Fig $a_1$](a.png){#fig:a}",
    "",
    "Tab $b_2$ {#tab:b}",
    "| x | y |",
    "|---|---|",
    "| 1 | 2 |",
    "",
    "```python Lst $c_3$ {#lst:c}",
    "x = 1",
    "```",
    "",
    "```alg Alg $d_4$ {#alg:d}",
    "\\begin{algorithmic}\\STATE x\\end{algorithmic}",
    "```",
    "",
    "```mus Mus $e_5$ {#mus:e}",
    "X:1\nK:C\nCDEF|",
    "```",
    "",
    "```mermaid Mer $f_6$ {#fig:f}",
    "graph TD; A-->B",
    "```",
  ].join("\n");
  const h = docHtml(md);
  for (const v of ["a_1", "b_2", "c_3", "d_4", "e_5", "f_6"]) {
    assert.match(h, new RegExp(`<annotation encoding="application/x-tex">${v}</annotation>`), `caption math ${v}`);
  }
  // Each caption keeps its number and its text around the math.
  assert.match(h, /Figure 1: Fig /);
  assert.match(h, /Table 1: Tab /);
  assert.match(h, /Listing 1: Lst /);
});

// Verifies REQ-121 (UC-15), slides
test("math in a caption renders on a slide", () => {
  const deck = api.buildSlideDeck("@slide\n![Decay $N_0$](a.png)\n@end\n");
  assert.match(slideHtml(deck), /<annotation encoding="application\/x-tex">N_0<\/annotation>/);
});

// Verifies REQ-123 (UC-15)
test("a $ that does not close in a caption stays a dollar sign, and plain captions stay plain", () => {
  const h = docHtml("![Costs $5 and more](a.png)\n\n![Plain caption](b.png)\n");
  assert.match(h, /Costs \$5 and more\./);
  assert.match(h, /Plain caption\./);
  assert.doesNotMatch(h, /class="katex"/);
});

// ─── Subscripts and superscripts ─────────────────────────────────────────────

// Verifies REQ-131 (UC-16)
test("^{x} is a superscript and _{x} a subscript", () => {
  assert.match(docHtml("H_{2}O and x^{2}\n"), /H<sub>2<\/sub>O and x<sup>2<\/sup>/);
});

// Verifies REQ-132 (UC-16)
test("sub/superscripts work in headings, list items, table cells, captions, slide titles and lead-ins", () => {
  const h = docHtml("# Head^{1}\n\n- item_{i}\n\n| a^{x} | b |\n|---|---|\n| 1 | _{2} |\n\n![Cap H_{2}O](a.png)\n");
  assert.match(h, /Head<sup>1<\/sup>/);
  assert.match(h, /item<sub>i<\/sub>/);
  assert.match(h, /<th>a<sup>x<\/sup><\/th>/);
  assert.match(h, /<sub>2<\/sub>/);
  assert.match(h, /Cap H<sub>2<\/sub>O/);
  const deck = api.buildSlideDeck("@slide[Title x^{2}](rtext)\nBody.\n@end(Lead H_{2}O)\n");
  const s = slideHtml(deck);
  assert.match(s, /Title x<sup>2<\/sup>/);
  assert.match(s, /Lead H<sub>2<\/sub>O/);
});

// Verifies REQ-133 (UC-16)
test("sub/superscript syntax is left alone in code, math and link destinations", () => {
  const h = docHtml("`c^{2}` and $y^{2}$ and [t](http://x.test/a_{b})\n\n```\nz_{1}\n```\n");
  assert.match(h, /<code>c\^\{2\}<\/code>/);
  assert.match(h, /z_\{1\}/);
  // The parser percent-encodes the braces of the destination; the point is that nothing became a <sub>.
  assert.match(h, /href="http:\/\/x\.test\/a_%7Bb%7D"/);
  assert.doesNotMatch(h, /<sup>2<\/sup>/);
});

// Verifies REQ-134 (UC-16)
test("braces hold inline Markdown and nest; empty or unclosed pairs stay literal", () => {
  const h = docHtml("m_{*i*} and a^{b_{c}}\n\nempty ^{} and open x_{ab\n\nsnake_case_name\n");
  assert.match(h, /m<sub><em>i<\/em><\/sub>/);
  assert.match(h, /a<sup>b<sub>c<\/sub><\/sup>/);
  assert.match(h, /empty \^\{\}/);
  assert.match(h, /open x_\{ab/);
  assert.match(h, /snake_case_name/);
});

// Verifies REQ-136 (UC-16)
test("a backslash makes the pair literal", () => {
  const h = docHtml("a\\^{b} and c\\_{d}\n");
  assert.match(h, /a\^\{b\} and c_\{d\}/);
  assert.doesNotMatch(h, /<su[bp]>/);
});

// Verifies REQ-131 (UC-16): neighbors of the syntax keep working
test("underline, strikethrough and footnotes still work beside sub/superscripts", () => {
  const h = docHtml("~u~ and ~~s~~ and x^{2} and a[^1]\n\n[^1]: note\n");
  assert.match(h, /<u>u<\/u>/);
  assert.match(h, /<del>s<\/del>/);
  assert.match(h, /x<sup>2<\/sup>/);
  assert.match(h, /data-footnote-ref|footnote/);
});

// ─── Video ───────────────────────────────────────────────────────────────────

// Verifies REQ-141 (UC-17)
test("image destinations with a video extension become <video controls>", () => {
  for (const url of ["a.mov", "dir/b.MP4", "c.m4v", "d.webm", "e.ogv", "f.mov?v=2#t=3"]) {
    assert.ok(isVideoUrl(url), url);
    const h = docHtml(`![Clip](${url})\n`);
    assert.match(h, /<video[^>]*controls/, url);
    assert.doesNotMatch(h, /<img/, url);
  }
  // The HTML export inlines a local video as a data: URI (REQ-141, REQ-147).
  assert.ok(isVideoUrl("data:video/mp4;base64,AAAA"));
  assert.match(docHtml("![Clip](data:video/mp4;base64,AAAA)\n"), /<video[^>]*controls/);
  assert.equal(isVideoUrl("data:image/png;base64,AAAA"), false);
  for (const url of ["a.png", "b.mov.png", "movie", "c.svg"]) assert.equal(isVideoUrl(url), false, url);
  assert.match(docHtml("![Pic](a.png)\n"), /<img/);
});

// Verifies REQ-142 (UC-17)
test("a video is a figure: alt text is the caption and a label numbers it", () => {
  const h = docHtml("![Pouring **fast**](pour.mov){#fig:pour}\n\nSee [@fig:pour].\n");
  assert.match(h, /<figure[^>]*id="fig:pour"/);
  assert.match(h, /<figcaption><strong>Figure 1: Pouring <strong>fast<\/strong>\.<\/strong><\/figcaption>/);
  assert.match(h, /href="#fig:pour"/);
});

// Verifies REQ-143 (UC-17)
test("the video is left to the browser: metadata preload, inline playback, no type attribute", () => {
  const h = docHtml("![Clip](a.mov)\n");
  assert.match(h, /preload="metadata"/);
  assert.match(h, /playsInline|playsinline/i);
  assert.doesNotMatch(h, /<video[^>]*\stype=/);
  assert.doesNotMatch(h, /<source/);
});

// Verifies REQ-146 (UC-17), REQ-171
test("on a slide a video is placed like an image, and is not preloaded as one", () => {
  const deck = api.buildSlideDeck("@slide[V](rtext)\nSome text.\n\n![Clip](a.mov)\n@end\n");
  assert.equal(deck.slides[0].layout, "rtext");
  assert.equal(deck.slides[0].images.length, 1);
  assert.match(slideHtml(deck), /<video/);
  assert.deepEqual(deck.imageUrls, []);
  const withImage = api.buildSlideDeck("@slide\n![Pic](a.png)\n\n![Clip](b.mov)\n@end\n");
  assert.deepEqual(withImage.imageUrls, ["a.png"]);
});

// ─── Table text ──────────────────────────────────────────────────────────────

// Verifies REQ-151, REQ-152 (UC-18), by inspection
test("table text is 0.9 times the text around it, in documents and slides; other text keeps its size", () => {
  const doc = css("CustomMarkdown.module.css");
  assert.match(doc, /\.markdownBody table \{[^}]*font-size: 0\.9em/s);
  assert.match(doc, /\.markdownBody table caption \{[^}]*font-size: 1\.1111em/s);
  const slides = css("slides/slides.css");
  assert.match(slides, /\.vfm-slide table \{ font-size: 0\.9em; \}/);
  assert.match(slides, /\.vfm-slide table caption \{ font-size: 1\.1111em; \}/);
  // 0.9 * 1.1111 = 1: a caption inside a table is not shrunk.
  assert.ok(Math.abs(0.9 * 1.1111 - 1) < 1e-3);
  // No other element rule in the slide sheet touches the base size of body text.
  assert.doesNotMatch(slides, /\.vfm-slide (p|li|ul|ol) \{[^}]*font-size/);
});

// ─── Jump to source ──────────────────────────────────────────────────────────

// Verifies REQ-161 (UC-19)
test("the title region carries the line of its @slide[title] opener or of its heading", () => {
  const deck = api.buildSlideDeck("# Intro\n\n@slide\nUnder a heading.\n@end\n\n@slide[Override]\nText.\n@end(Lead)\n");
  assert.equal(deck.slides[0].titleLine, 1);
  assert.match(slideHtml(deck, 0), /<header class="vfm-slide-title" data-line="1">/);
  assert.equal(deck.slides[1].titleLine, 7);
  assert.match(slideHtml(deck, 1), /<header class="vfm-slide-title" data-line="7">/);
});

// Verifies REQ-161 (UC-19): a title taken from the heading a split slide starts with
test("a slide titled by the heading it starts with points at that heading", () => {
  const deck = api.buildSlideDeck("@slide\n## First\n\nText one.\n\n## Second\n\nText two.\n@end\n");
  const titled = deck.slides.filter((s: any) => s.titleSource === "heading");
  for (const s of titled) assert.ok(typeof s.titleLine === "number" && s.titleLine > 1, JSON.stringify(s.title));
});

// Verifies REQ-162 (UC-19)
test("the lead-in carries the line of its @end", () => {
  const deck = api.buildSlideDeck("@slide[T]\nText.\n@end(Lead-in text)\n");
  assert.equal(deck.slides[0].leadinLine, 3);
  assert.match(slideHtml(deck), /<footer class="vfm-slide-leadin" data-line="3">/);
  const none = api.buildSlideDeck("@slide[T]\nText.\n@end\n");
  assert.equal(none.slides[0].leadinLine, undefined);
});

// Verifies REQ-161, REQ-162 (UC-19): section slides and included files keep their lines
test("a section slide's heading carries its line, and lines follow the source map", () => {
  const deck = api.buildSlideDeck("@slide[Section]\n@end\n");
  assert.match(slideHtml(deck), /<h1 class="vfm-divider-title" data-line="1">/);
  const mapped = api.buildSlideDeck("@slide[T]\nText.\n@end(Lead)\n", { sourceMap: [{ line: 10, file: "x.md" }, { line: 11, file: "x.md" }, { line: 12, file: "x.md" }] });
  assert.equal(mapped.slides[0].leadinLine, 3, "data-line is the parsed text's line; the host maps it with its source map");
  assert.equal(mapped.slides[0].sourceBlock.endLoc.file, "x.md");
});

// ─── Images ──────────────────────────────────────────────────────────────────

// Verifies REQ-171 (UC-20), by inspection
test("the stylesheet lets a picture or video shrink to its region without cropping", () => {
  const sheet = css("slides/slides.css");
  assert.match(sheet, /\.vfm-slide \.vfm-region > figure,[^{]*\{[^}]*max-height: 100%[^}]*min-height: 0/s);
  assert.match(sheet, /\.vfm-slide \.vfm-region img,\s*\.vfm-slide \.vfm-region video \{[^}]*object-fit: contain/s);
  // Only the title slide's background image (REQ-211) is cropped to cover; slide content never is.
  assert.doesNotMatch(sheet.replace(/\.vfm-cover-bg \{[^}]*\}/s, ""), /object-fit: cover/);
});

// Verifies REQ-172 (UC-20)
test("two images on a 2col slide with no text each get a column", () => {
  const deck = api.buildSlideDeck("@slide[Two](2col)\n![Left](a.png)\n\n![Right](b.png)\n@end\n");
  assert.equal(deck.slides.length, 1);
  assert.equal(deck.slides[0].layout, "2col");
  assert.equal(deck.slides[0].images.length, 2);
  const h = slideHtml(deck);
  assert.equal((h.match(/class="vfm-region vfm-images vfm-fit"/g) ?? []).length, 2);
  assert.match(h, /<img src="a.png"[\s\S]*<img src="b.png"/);
});

// Verifies REQ-173 (UC-20)
test("a 2col slide with text, or with one image, stays one column in source order", () => {
  const withText = api.buildSlideDeck("@slide(2col)\nText.\n\n![Cap](a.png)\n@end\n");
  assert.equal(withText.slides[0].layout, "single");
  assert.equal(withText.slides[0].images.length, 0);
  const lone = api.buildSlideDeck("@slide(2col)\n![Cap](a.png)\n@end\n");
  assert.equal(lone.slides[0].layout, "single");
  assert.equal(lone.slides[0].body.length, 1);
  const noImage = api.buildSlideDeck("@slide(2col)\nOnly text.\n@end\n");
  assert.equal(noImage.slides[0].layout, "2col");
});

// Verifies REQ-174 (UC-20)
test("a 2col block with more images than fit continues on a new slide", () => {
  const deck = api.buildSlideDeck("@slide[Three](2col)\n![A](a.png)\n\n![B](b.png)\n\n![C](c.png)\n@end\n");
  assert.equal(deck.slides.length, 2);
  assert.equal(deck.slides[0].images.length, 2);
  assert.equal(deck.slides[0].layout, "2col");
  assert.equal(deck.slides[1].body.length + deck.slides[1].images.length, 1);
});

// Verifies REQ-172 (UC-20): two videos work the same way
test("two videos on a 2col slide each get a column", () => {
  const deck = api.buildSlideDeck("@slide(2col)\n![One](a.mov)\n\n![Two](b.mp4)\n@end\n");
  assert.equal(deck.slides[0].layout, "2col");
  assert.equal((slideHtml(deck).match(/<video/g) ?? []).length, 2);
});
