/**
 * Tests for `preview-bugs`: a task checkbox shows the state of its item, highlighted math, citations in captions and
 * lead-ins, captions without a period on slides, lines for double-click jumps, bullet sets on 2col slides, the
 * References slide, and the stylesheet rules for math, tables, videos and figures. Each test names the requirements
 * (docs/REQUIREMENTS.md) and use cases (docs/USE_CASES.md) that it verifies.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadApi } from "./helpers/loadApi.ts";

const css = (file: string) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", file), "utf8");

const t = loadApi();
before(t.load);
after(t.cleanup);

const opts = (extra: object = {}) => ({ numberingDepth: 1, numberCaptions: "all", headingShift: 0, id: null, ...extra });
const doc = (md: string, extra: object = {}) => {
  const o = opts(extra);
  return t.state.ssr.renderToStaticMarkup(t.state.ssr.renderMarkdown(md, o, t.state.ssr.collectRegistry(md, o)));
};
const entry = (citeKey: string, title: string) => ({ citeKey, entryType: "article", fields: { title, year: "2020", journal: "J" }, authors: ["Smith, Ann"], editors: [] });
const bibliography = (...keys: string[]) => new Map(keys.map((k) => [k, entry(k, `Title of ${k}`)]));
const deck = (md: string, extra: object = {}) => t.state.api.buildSlideDeck(md, extra);
const slideHtml = (d: any, i: number) => t.state.ssr.renderToStaticMarkup(t.state.api.renderSlide(d.slides[i], d.render, { number: i + 1 }));
const allHtml = (d: any) => d.slides.map((_: any, i: number) => slideHtml(d, i)).join("\n");

// ─── Task checkboxes ─────────────────────────────────────────────────────────

/** Every React element in a rendered tree whose type is `type`. */
function findAll(node: any, type: unknown, out: any[] = []): any[] {
  if (Array.isArray(node)) node.forEach((n) => findAll(n, type, out));
  else if (node && typeof node === "object") {
    if (node.type === type) out.push(node);
    findAll(node.props?.children, type, out);
  }
  return out;
}

// Verifies REQ-321 (UC-48)
test("a task checkbox always says whether it is checked, so unticking an item in the file unticks the box in the preview", () => {
  const { TaskCheckbox } = t.state.ssr;
  // The bug: an open item has no `checked` in the markup, so the box was no longer controlled after it was ticked.
  assert.equal(TaskCheckbox({ type: "checkbox" }).props.checked, false);
  assert.equal(TaskCheckbox({ type: "checkbox", checked: true }).props.checked, true);
  assert.equal(TaskCheckbox({ type: "checkbox", checked: false }).props.checked, false);
  assert.equal(TaskCheckbox({ type: "checkbox" }).props.readOnly, true);
  assert.equal(TaskCheckbox({ type: "text" }).props.checked, undefined, "an input that is not a checkbox is left alone");
});

// Verifies REQ-321 (UC-48)
test("the rendered document uses that checkbox for every task item, open or done", () => {
  const md = "- [x] done\n- [ ] open\n";
  const tree = t.state.ssr.renderMarkdown(md, opts(), t.state.ssr.collectRegistry(md, opts()));
  const boxes = findAll(tree, t.state.ssr.TaskCheckbox);
  assert.equal(boxes.length, 2);
  assert.deepEqual(boxes.map((b: any) => Boolean(b.props.checked)), [true, false]);
});

// ─── Highlighted math ────────────────────────────────────────────────────────

// Verifies REQ-322 (UC-45)
test("==$math==: a highlight holds math in a paragraph, a caption and a lead-in", () => {
  assert.match(doc("A ==$J_2$== here.\n"), /<mark><span class="math math-inline">/);
  assert.match(doc("![The ==$J_2$== term](a.png)\n"), /<figcaption>.*<mark><span class="math math-inline">/);
  const d = deck("@slide[T]\nText.\n@end(Note ==$J_2$== here)\n");
  assert.match(slideHtml(d, 0), /vfm-slide-leadin[\s\S]*<mark><span class="math math-inline">/);
  assert.doesNotMatch(slideHtml(d, 0), /\$J_2\$/, "no dollar signs are left over");
});

// ─── Citations in captions and lead-ins ──────────────────────────────────────

// Verifies REQ-323 (UC-51)
test("@cite works in a caption in document mode: a link, and an entry in the reference list", () => {
  const html = doc("![A map @cite(a)](a.png)\n\nCounts @cite(b)\n| x | y |\n| - | - |\n| 1 | 2 |\n", { bibliography: bibliography("a", "b") });
  assert.match(html, /<figcaption>[\s\S]*<a href="#ref-a" class="citation">Smith, 2020<\/a>/);
  assert.match(html, /<caption>[\s\S]*<a href="#ref-b" class="citation">/);
  assert.match(html, /<li id="ref-a">/);
  assert.match(html, /<li id="ref-b">/);
});

// Verifies REQ-323 (UC-51)
test("@cite works in a caption and in a lead-in on a slide, and a cite nowhere else in the deck still counts", () => {
  const md = "@slide[T]\n![A map @cite(a)](a.png)\n@end(See @cite(b))\n";
  const d = deck(md, { bibliography: bibliography("a", "b") });
  assert.deepEqual(d.diagnostics.filter((x: any) => x.severity === "error"), []);
  const html = slideHtml(d, 0);
  assert.match(html, /<figcaption>[\s\S]*class="citation"/);
  assert.match(html, /vfm-slide-leadin[\s\S]*class="citation"/);
  assert.deepEqual(d.render.citeKeys, ["a", "b"]);
});

// Verifies REQ-323 (UC-51)
test("a slide title still cannot hold @cite, and a lead-in can", () => {
  const bad = t.state.api.checkSlides("@slide[A @cite(k)]\nx\n@end");
  assert.ok(bad.some((d: any) => d.code === "syntax" && /@cite/.test(d.message)));
  const ok = t.state.api.checkSlides("@slide\nx\n@end(see @cite(k))");
  assert.ok(!ok.some((d: any) => d.severity === "error"), JSON.stringify(ok));
});

// Verifies REQ-323 (UC-51)
test("showrefs lists a reference cited only in a caption or a lead-in", () => {
  const d = deck("@slide[T](showrefs)\n![Map @cite(a)](a.png)\n@end(See @cite(b))\n", { bibliography: bibliography("a", "b") });
  assert.deepEqual(d.slides[0].references.map((r: any) => r.citeKey).sort(), ["a", "b"]);
});

// ─── Captions on slides ──────────────────────────────────────────────────────

// Verifies REQ-324 (UC-55)
test("a caption ends with a period in a document and has none on a slide", () => {
  const md = "![A map](a.png)\n\nCounts\n| x | y |\n| - | - |\n| 1 | 2 |\n\n```py Square it\nx*x\n```\n";
  const docHtml = doc(md);
  assert.match(docHtml, /<figcaption><strong>Figure 1: A map\.<\/strong>/);
  assert.match(docHtml, /<caption><strong>Table 1: Counts\.<\/strong>/);
  assert.match(docHtml, /Square it\.<\/strong>/);
  const html = allHtml(deck(`@slide[T]\n![A map](a.png)\n@end\n\n@slide[U]\nCounts\n| x | y |\n| - | - |\n| 1 | 2 |\n@end\n\n@slide[V]\n\`\`\`py Square it\nx*x\n\`\`\`\n@end\n`));
  assert.match(html, /<figcaption><strong>A map<\/strong>/);
  assert.match(html, /<caption><strong>Counts<\/strong>/);
  assert.match(html, /Square it<\/strong>/);
  assert.doesNotMatch(html, /(A map|Counts|Square it)\./);
});

// Verifies REQ-324 (UC-55)
test("a slide caption keeps the punctuation the author wrote", () => {
  const html = allHtml(deck("@slide[T]\n![Is it a map?](a.png)\n@end\n"));
  assert.match(html, /Is it a map\?<\/strong>/);
});

// ─── Lines for double-click jumps ────────────────────────────────────────────

// Verifies REQ-325 (UC-49)
test("a figure carries the line of its image, in a document and on a slide", () => {
  const md = "Intro paragraph.\n\n\n![A map](a.png)\n";
  assert.match(doc(md), /<figure class="labeled-figure" data-line="4">/);
  const d = deck("@slide[T]\nWords.\n\n![A map](a.png)\n@end\n");
  assert.match(allHtml(d), /<figure class="labeled-figure" data-line="4">/);
  assert.match(doc("![A map](a.png){#fig:a}\n"), /<figure class="labeled-figure" id="fig:a" data-line="1">/);
});

// Verifies REQ-325 (UC-49)
test("text around an image keeps the paragraph's line and the figure keeps the image's", () => {
  const html = doc("Before the picture\n![A map](a.png)\nafter it\n");
  assert.match(html, /<p data-line="1">Before the picture\s*<\/p>/);
  assert.match(html, /<figure class="labeled-figure" data-line="2">/);
});

// Verifies REQ-326 (UC-49)
test("headerKeyLine finds the line of a top-level key of the YAML header", () => {
  const { headerKeyLine } = t.state.ssr;
  const text = "---\ntitle: T\nsubtitle: S\nauthors:\n  - name: A\ndate: 2026\n---\n\nBody\ntitle: not this\n";
  assert.equal(headerKeyLine(text, ["title"]), 2);
  assert.equal(headerKeyLine(text, ["subtitle"]), 3);
  assert.equal(headerKeyLine(text, ["author", "authors"]), 4);
  assert.equal(headerKeyLine(text, ["date"]), 6);
  assert.equal(headerKeyLine(text, ["abstract"]), undefined);
  assert.equal(headerKeyLine("No header\ntitle: x\n", ["title"]), undefined);
  assert.equal(headerKeyLine("﻿---\ntitle: T\n---\n", ["title"]), 2);
});

// Verifies REQ-326 (UC-49)
test("each part of the title slide carries the line of the YAML key it came from", () => {
  const md = "---\ntitle: Deck\nsubtitle: Sub\nauthor: Ann\ndate: 2026\n---\n\n@slide[One]\nText.\n@end\n";
  const d = deck(md);
  const cover = slideHtml(d, 0);
  assert.match(cover, /<section[^>]*data-line="2"/, "the slide itself: the title");
  assert.match(cover, /<h1[^>]*data-line="2"/);
  assert.match(cover, /vfm-cover-subtitle" data-line="3"/);
  assert.match(cover, /vfm-cover-authors" data-line="4"/);
  assert.match(cover, /vfm-cover-date" data-line="5"/);
});

// ─── Bullet sets on 2col slides ──────────────────────────────────────────────

const lists = (html: string) => html.match(/<[uo]l[^>]*>/g) ?? [];
const twoCol = (body: string) => allHtml(deck(`@slide[T](2col)\n${body}\n@end\n`));

// Verifies REQ-327 (UC-52)
test("2col: a blank line between two groups of bullets makes two sets, and a comment alone does not", () => {
  assert.equal(lists(twoCol("- a1\n- a2\n\n- b1\n- b2")).length, 2, "blank line: two lists");
  assert.equal(lists(twoCol("- a1\n- a2\n<!-- a note -->\n- b1\n- b2")).length, 1, "a comment alone: one list");
  assert.equal(lists(twoCol("- a1\n- a2\n\n<!-- a note -->\n\n- b1\n- b2")).length, 2, "a comment between blank lines: still two");
  assert.equal(lists(twoCol("- a1\n- a2\n- b1\n- b2")).length, 1, "no blank line: one list");
});

// Verifies REQ-327 (UC-52)
test("2col: every set keeps its own items, and numbers go on counting through the sets", () => {
  const html = twoCol("1. one\n2. two\n\n3. three\n4. four");
  const ols = html.match(/<ol[^>]*>[\s\S]*?<\/ol>/g)!;
  assert.equal(ols.length, 2);
  assert.match(ols[0], /one[\s\S]*two/);
  assert.match(ols[1], /start="3"/);
  assert.match(ols[1], /three[\s\S]*four/);
});

// Verifies REQ-327 (UC-52)
test("other layouts read a blank line between bullets as Markdown does: one loose list", () => {
  const html = allHtml(deck("@slide[T]\n- a1\n- a2\n\n- b1\n- b2\n@end\n"));
  assert.equal(lists(html).length, 1);
});

// ─── The References slide ────────────────────────────────────────────────────

const lastSlide = (d: any) => d.slides[d.slides.length - 1];

// Verifies REQ-328 (UC-51)
test("a deck that cites ends with a References slide that lists each cited entry once, in full size", () => {
  const md = "@slide[A]\nOne @cite(a).\n@end\n\n@slide[B]\nTwo @cite(a, b).\n@end\n";
  const d = deck(md, { bibliography: bibliography("a", "b") });
  const last = lastSlide(d);
  assert.equal(last.referencesSlide, true);
  assert.equal(d.slides.length, 3);
  const html = slideHtml(d, 2);
  assert.match(html, /<header[^>]*><div class="vfm-inline"><p>References<\/p>/);
  assert.match(html, /vfm-refs-full/);
  assert.equal((html.match(/<li id="ref-/g) ?? []).length, 2);
  assert.doesNotMatch(html, /vfm-slide-refs/, "not the small list at the foot of a slide");
});

// Verifies REQ-328 (UC-51)
test("the References slide includes entries cited only in a caption or lead-in, and numbered styles keep their numbers", () => {
  const d = deck("@slide[A]\n![Map @cite(a)](a.png)\n@end(See @cite(b))\n", { bibliography: bibliography("a", "b"), citations: { citationStyle: "number" } });
  const html = slideHtml(d, d.slides.length - 1);
  assert.match(html, /<ol>/);
  assert.equal((html.match(/<li id="ref-/g) ?? []).length, 2);
});

// Verifies REQ-328 (UC-51)
test("a deck that cites nothing, or has no bibliography, has no References slide", () => {
  assert.ok(!deck("@slide[A]\nNothing cited.\n@end\n", { bibliography: bibliography("a") }).slides.some((s: any) => s.referencesSlide));
  assert.ok(!deck("@slide[A]\nCited @cite(a).\n@end\n").slides.some((s: any) => s.referencesSlide));
  assert.ok(!deck("@slide[A]\nUnknown @cite(zzz).\n@end\n", { bibliography: bibliography("a") }).slides.some((s: any) => s.referencesSlide));
});

// Verifies REQ-328 (UC-51)
test("a long reference list continues on further References slides, cut between entries", () => {
  const keys = Array.from({ length: 20 }, (_, i) => `k${i}`);
  const d = deck(`@slide[A]\nMany ${keys.map((k) => `@cite(${k})`).join(" ")}.\n@end\n`, { bibliography: bibliography(...keys) });
  const refs = d.slides.filter((s: any) => s.referencesSlide);
  assert.ok(refs.length >= 2, `${refs.length} slides`);
  assert.deepEqual(refs.map((s: any) => s.continuation.index), refs.map((_: any, i: number) => i + 1));
  assert.ok(refs.every((s: any) => s.continuation.of === refs.length));
  assert.equal(refs.flatMap((s: any) => s.references.map((r: any) => r.citeKey)).length, 20);
  assert.match(slideHtml(d, d.slides.indexOf(refs[0])), /\(1\/\d+\)/);
});

// Verifies REQ-328 (UC-51)
test("the References slide is not a slide of the author's file: no line of the file lands on it", () => {
  const d = deck("@slide[A]\nOne @cite(a).\n@end\n", { bibliography: bibliography("a") });
  const b = lastSlide(d).sourceBlock;
  assert.ok(b.openLine > 1e9 && b.closeLine > 1e9);
});

// ─── Stylesheet rules (what only a browser can show is a manual test: MT-23 to MT-26) ───

// Verifies REQ-329 (UC-55)
test("a slide region that holds math keeps room below its last line", () => {
  assert.match(css("slides/slides.css"), /\.vfm-region:has\(\.katex\) \{[^}]*padding-bottom: 0\.4em/s);
});

// Verifies REQ-330 (UC-55)
test("a table on a slide is never wider than its region, and a long word wraps", () => {
  const sheet = css("slides/slides.css");
  assert.match(sheet, /\.vfm-slide\.vfm-slide table \{[^}]*max-width: 100%[^}]*box-sizing: border-box[^}]*padding: 1px/s);
  assert.match(sheet, /\.vfm-slide\.vfm-slide table td \{[^}]*overflow-wrap: anywhere/s);
});

// Verifies REQ-331 (UC-55)
test("a video fills the width of its figure or region, 16:9 until its size is known", () => {
  assert.match(css("slides/slides.css"), /\.vfm-slide \.vfm-region video \{[^}]*width: 100%[^}]*aspect-ratio: auto 16 \/ 9/s);
  assert.match(css("CustomMarkdown.module.css"), /\.labeled-figure\) video \{[^}]*width: 100%[^}]*aspect-ratio: auto 16 \/ 9/s);
});

// Verifies REQ-332 (UC-55)
test("a table in a document has room for the half of its collapsed border that falls outside it", () => {
  assert.match(css("CustomMarkdown.module.css"), /\.markdownBody table \{[^}]*box-sizing: border-box;[^}]*padding: 1px/s);
});

// Verifies REQ-333 (UC-50)
test("a figure or a listing is shorter than the window, and is scrolled to with room above, so a jump shows it with its caption", () => {
  const sheet = css("CustomMarkdown.module.css");
  assert.match(sheet, /@media screen \{[\s\S]*labeled-figure\) img,[\s\S]*max-height: calc\(100vh - 8em\)/);
  assert.match(sheet, /code-listing\) pre \{[^}]*max-height: calc\(100vh - 8em\)[^}]*overflow: auto/s);
  assert.match(sheet, /scroll-margin-top: 1em/);
  assert.doesNotMatch(css("slides/slides.css") + sheet, /scroll-behavior/, "no script and no smooth-scroll rule decides where the page lands");
  assert.match(css("slides/slides.css"), /\.vfm-slide\.vfm-slide \.labeled-figure img[\s\S]*max-height: none/, "a slide fits its figure to the region, not the window");
});
