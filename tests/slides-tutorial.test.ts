/**
 * The slides tutorial (docs/tutorial/SLIDES_TUTORIAL.md) and its eleven example decks (docs/tutorial/slides/): every deck builds
 * and renders, and each shows the structure the tutorial says it shows.
 *
 * Each test names the requirements (docs/REQUIREMENTS.md) and use cases (docs/USE_CASES.md) it verifies.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadApi } from "./helpers/loadApi.ts";
import { deckFiles, decksDir, readDeck, summarize, tutorialBibliography, tutorialDir } from "./helpers/slideDecks.ts";

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

const bibliography = tutorialBibliography();
const build = (name: string) => {
  const source = readDeck(t.state.api, name);
  return { source, deck: t.state.api.buildSlideDeck(source.text, { sourceMap: source.sourceMap, bibliography }) };
};
const clean = (html: string) => html.replace(/\sdata-line="\d+"/g, "");
const slideHtml = (deck: any, i: number) => clean(t.state.ssr.renderToStaticMarkup(t.state.ssr.renderSlide(deck.slides[i], deck.render)));
const docHtml = (text: string) => clean(t.state.ssr.renderToStaticMarkup(t.state.ssr.renderMarkdown(text, { numberingDepth: 0 })));
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;
const codes = (deck: any) => deck.diagnostics.map((d: any) => d.code);

const tutorial = readFileSync(join(tutorialDir, "SLIDES_TUTORIAL.md"), "utf8");

// ─── Every deck ──────────────────────────────────────────────────────────────

// Verifies REQ-318 (UC-47)
test("the example decks: there are eleven, each builds with no error, renders every slide, and renders as a document", () => {
  const files = deckFiles();
  assert.equal(files.length, 11);
  for (const name of files) {
    const { source, deck } = build(name);
    assert.deepEqual(deck.diagnostics.filter((d: any) => d.severity === "error"), [], `${name}: errors`);
    assert.ok(deck.slides.length >= 2, `${name}: only ${deck.slides.length} slides`);
    deck.slides.forEach((_: unknown, i: number) => assert.ok(slideHtml(deck, i).length > 40, `${name}: slide ${i + 1} renders to nothing`));
    assert.doesNotThrow(() => docHtml(source.text), `${name}: document mode`);
  }
});

// ─── Deck by deck ────────────────────────────────────────────────────────────

// Verifies REQ-319 (UC-47)
test("deck 01: a title slide from the header, a title from the heading with a lead-in, a title from the override", () => {
  const { deck } = build("01-first-slides.md");
  const s = summarize(deck);
  assert.deepEqual(s.map((x) => [x.cover, x.title, x.titleSource, x.leadin]), [
    [true, "", "none", false],
    [false, "Why slides from Markdown", "heading", true],
    [false, "What to try next", "override", false],
  ]);
  assert.match(slideHtml(deck, 1), /The same file reads as a document\./);
  // The paragraph outside every block is slide-mode silent and document-mode visible.
  assert.doesNotMatch(slideHtml(deck, 1) + slideHtml(deck, 2), /outside every/);
  assert.match(docHtml(build("01-first-slides.md").source.text), /outside every/);
});

// Verifies REQ-319 (UC-47)
test("deck 02: heading, override and blank titles; dividers merge into one agenda; a title-only block stands alone", () => {
  const { deck } = build("02-titles-and-sections.md");
  const s = summarize(deck);
  assert.deepEqual(s.map((x) => [x.title, x.titleSource]), [
    ["", "none"],
    ["Methods", "heading"],
    ["A title of your own", "override"],
    ["", "override"],
    ["Results", "heading"],
    ["Results", "heading"],
    ["", "none"],
  ]);
  const agenda = slideHtml(deck, 5);
  assert.equal(count(agenda, /<li/g), 3, "three dividers make one agenda with three entries");
  assert.match(agenda, /First finding[\s\S]*Second finding[\s\S]*Third finding/);
  assert.deepEqual(s[6].body, ["heading"], "the title-only block is one large heading");
  assert.match(slideHtml(deck, 6), /Thank you/);
});

// Verifies REQ-319 (UC-47)
test("deck 03: rtext and ltext with a picture, two columns of text, two pictures one per column, a table", () => {
  const { deck } = build("03-layouts.md");
  const s = summarize(deck).slice(1);
  assert.deepEqual(s.map((x) => [x.layout, x.images]), [["rtext", 1], ["ltext", 1], ["2col", 0], ["2col", 2], ["single", 0]]);
  assert.deepEqual(s[4].body, ["table"]);
  assert.match(slideHtml(deck, 1), /vfm-layout-rtext/);
  assert.match(slideHtml(deck, 2), /vfm-layout-ltext/);
});

// Verifies REQ-319 (UC-47)
test("deck 04: steplists reveals one item per step, stepleadin adds the lead-in last, and the default shows everything", () => {
  const { deck } = build("04-reveal-steps.md");
  const s = summarize(deck).slice(1);
  assert.deepEqual(s.map((x) => [x.steps, x.leadin]), [[5, false], [5, true], [1, false]]);
  // 3 items + 1 nested item = 4 steps after step 0; 3 items + the lead-in = 4.
  assert.equal(count(slideHtml(deck, 1), /data-step=/g) >= 4, true);
});

// Verifies REQ-319 (UC-47)
test("deck 05: paragraphs become slide text by shape, and a --- line ends the slide", () => {
  const { deck } = build("05-paragraphs.md");
  assert.equal(count(slideHtml(deck, 1), /<li/g), 2, "a long paragraph keeps two sentences");
  assert.doesNotMatch(slideHtml(deck, 1), /leaves the rest in the file/);
  assert.match(slideHtml(deck, 2), /<strong>Every word on a reduced slide occurs in the source paragraph\.<\/strong>/);
  assert.match(slideHtml(deck, 3), /<ol/);
  assert.equal(count(slideHtml(deck, 3), /<li/g), 3, "ordinals make a numbered list of three");
  const colon = slideHtml(deck, 4);
  assert.match(colon, /several shapes:[\s\S]*<ul>[\s\S]*<li>lists<\/li>[\s\S]*<li>plain prose<\/li>/, "a colon nests the items beneath one bullet");
  assert.match(slideHtml(deck, 5), /vfm-callout/);
  const s = summarize(deck);
  assert.deepEqual([s[6].part, s[7].part, s[6].title === s[7].title], ["1/2", "2/2", true]);
  assert.ok(codes(deck).includes("split"));
});

// Verifies REQ-319 (UC-47)
test("deck 06: a reference stays on its own slide, is dropped from another, noxrefs drops all, an equation is numbered, nodoc stays out of the document", () => {
  const { deck, source } = build("06-figures-tables-and-references.md");
  assert.match(slideHtml(deck, 1), /class="xref"[^>]*>Figure 1</, "the figure's own slide keeps the reference");
  assert.doesNotMatch(slideHtml(deck, 2), /class="xref"/);
  assert.match(slideHtml(deck, 2), /has no reference, so it stays/);
  assert.doesNotMatch(slideHtml(deck, 2), /points at/, "the sentence with the dangling reference is dropped");
  assert.match(slideHtml(deck, 3), /<caption>/, "the paragraph touching the table is its caption");
  assert.doesNotMatch(slideHtml(deck, 4), /class="xref"/);
  assert.match(slideHtml(deck, 4), /has no reference, so it stays/);
  assert.match(slideHtml(deck, 5), /class="xref"[^>]*>Equation 1</);
  assert.equal(codes(deck).filter((c: string) => c === "drop-xref").length, 2);
  assert.match(slideHtml(deck, 6), /only ever seen as a slide/);
  assert.doesNotMatch(docHtml(source.text), /only ever seen as a slide/);
});

// Verifies REQ-319 (UC-47)
test("deck 07: showrefs lists each reference once, notes are for the presenter only, a footnote shows on its own slide", () => {
  const { deck, source } = build("07-citations-notes-footnotes.md");
  const s = summarize(deck).slice(1);
  assert.deepEqual(s.map((x) => [x.references, x.notes]), [[2, 1], [1, 1], [0, 0]]);
  assert.match(slideHtml(deck, 1), /Gruber, 2004/);
  assert.match(slideHtml(deck, 2), /Knuth/);
  assert.doesNotMatch(slideHtml(deck, 2).split("vfm-slide-refs")[1] ?? "", /Gruber, J\./, "a reference already shown is not listed again");
  const notes = t.state.ssr.renderToStaticMarkup(t.state.ssr.renderNotes(deck.slides[1], deck.render));
  assert.match(notes, /Mention that the reference list is built from the bibliography file\./);
  assert.doesNotMatch(slideHtml(deck, 1), /Mention that/);
  assert.doesNotMatch(docHtml(source.text), /Mention that/);
  assert.match(slideHtml(deck, 3), /data-footnotes[\s\S]*Defined between/);
});

// Verifies REQ-319 (UC-47)
test("deck 08: the cover image and numbered affiliations, the separator color, and colored section slides", () => {
  const { deck } = build("08-colors-and-cover.md");
  const cover = slideHtml(deck, 0);
  assert.match(cover, /vfm-cover-image/);
  assert.match(cover, /src="\.\.\/cover\.svg"/);
  assert.match(cover, /Ada Lovelace<sup>1<\/sup>[\s\S]*Alan Turing<sup>2<\/sup>/);
  assert.match(cover, /Analytical Engine Lab[\s\S]*Bletchley Park/);
  assert.match(cover, /--vfm-slide-accent:#1a6ea8/);
  assert.match(cover, /--vfm-slide-rule:#d98e04/);
  const section = slideHtml(deck, 1);
  assert.match(section, /vfm-section-colored/);
  assert.match(section, /--vfm-slide-section-bg:#16324f/);
  assert.match(section, /vfm-on-dark/, "light text on a dark section color");
  assert.match(slideHtml(deck, 2), /--vfm-slide-rule:#d98e04/);
});

// Verifies REQ-319 (UC-47)
test("deck 09: math, a diagram, an algorithm, a score and code, one per slide", () => {
  const { deck } = build("09-math-diagrams-code.md");
  assert.deepEqual(summarize(deck).slice(1).map((x) => x.body), [["math"], ["mermaidBlock"], ["algorithmBlock"], ["musicBlock"], ["code"]]);
});

// Verifies REQ-319 (UC-47)
test("deck 10: @include splices in the agenda and the closing slide, and diagnostics name the files", () => {
  const { deck, source } = build("10-includes.md");
  const s = summarize(deck);
  assert.deepEqual(s.map((x) => x.title), ["", "This slide is in the main file", "Agenda", ""]);
  assert.equal(count(slideHtml(deck, 2), /<li/g), 3);
  assert.equal(deck.diagnostics.length, 0);
  assert.ok((source.sourceMap as any[]).some((loc) => loc.file && loc.file.endsWith("agenda.md")), "lines of parts/agenda.md map back to that file");
  assert.ok(existsSync(join(decksDir, "parts", "closing.md")));
});

// Verifies REQ-319 (UC-47)
test("deck 11: the whole talk has eight slides that use titles, an agenda, steps, notes, a picture, a table and a citation together", () => {
  const { deck } = build("11-a-whole-talk.md");
  const s = summarize(deck);
  assert.equal(s.length, 8);
  assert.deepEqual(s.map((x) => x.title), ["", "Why this talk", "Outline", "Sentences", "What earns points", "Weights", "Headline result", "Summary"]);
  assert.deepEqual([s[1].steps, s[1].leadin, s[1].notes], [5, true, 1]);
  assert.equal(count(slideHtml(deck, 2), /<li/g), 3, "the outline is an agenda made of three headings");
  assert.deepEqual([s[4].layout, s[4].images, s[4].steps], ["rtext", 1, 5]);
  assert.match(slideHtml(deck, 5), /<caption>/);
  assert.deepEqual([s[6].body, s[6].references, s[6].notes], [["vfmCallout"], 1, 1]);
  assert.deepEqual(deck.diagnostics.filter((d: any) => d.severity !== "info"), []);
});

// ─── The tutorial text ───────────────────────────────────────────────────────

/** The text of every ````markdown example in the tutorial that holds an @slide block. */
function slideExamples(md: string): string[] {
  const out: string[] = [];
  const lines = md.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const open = /^(`{3,})markdown\s*$/.exec(lines[i]);
    if (!open) continue;
    const body: string[] = [];
    for (i++; i < lines.length && !new RegExp(`^\`{${open[1].length},}\\s*$`).test(lines[i]); i++) body.push(lines[i]);
    if (body.some((l) => l.startsWith("@slide"))) out.push(body.join("\n") + "\n");
  }
  return out;
}

// Verifies REQ-320 (UC-47)
test("every @slide example in the tutorial builds as a deck without an error", () => {
  const examples = slideExamples(tutorial);
  assert.ok(examples.length >= 8, `only ${examples.length} slide examples`);
  for (const example of examples) {
    // An example may use @include and a picture; give it the tutorial's folder as its base.
    const read = (p: string) => {
      try {
        return readFileSync(join(decksDir, p.replace(/^\/+/, "")), "utf8");
      } catch {
        return null;
      }
    };
    const expanded = t.state.api.expandIncludes(example, { file: join(decksDir, "example.md"), read, resolve: (_from: string, rel: string) => rel });
    let deck: any;
    assert.doesNotThrow(() => (deck = t.state.api.buildSlideDeck(expanded.text, { bibliography })), `does not build:\n${example}`);
    assert.deepEqual(deck.diagnostics.filter((d: any) => d.severity === "error"), [], `has an error:\n${example}`);
    assert.ok(deck.slides.length >= 1, `makes no slide:\n${example}`);
  }
});

// Verifies REQ-320 (UC-47)
test("the tutorial names every example deck, and every deck it names exists", () => {
  const named = [...tutorial.matchAll(/\]\(slides\/([^)]+\.md)\)/g)].map((m) => m[1]);
  for (const name of deckFiles()) assert.ok(named.includes(name), `${name} is not linked from the tutorial`);
  for (const name of new Set(named)) assert.ok(existsSync(join(decksDir, name)), `${name} is linked but missing`);
  for (const f of ["circle.svg", "wide.svg", "cover.svg", "tutorial.bib"]) assert.ok(existsSync(join(tutorialDir, f)), f);
});
