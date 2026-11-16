/**
 * Tests for tables on slides: a table is never lost, and its text is sized to fit. Each test names the
 * requirements (docs/REQUIREMENTS.md) and use cases (docs/USE_CASES.md) that it verifies.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadApi } from "./helpers/loadApi.ts";
import { TABLE_SCALE_DEFAULT, TABLE_SCALE_MIN, TABLE_SCALE_STEP } from "../constants.ts";

const css = (file: string) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", file), "utf8");

const t = loadApi();
before(t.load);
after(t.cleanup);

const tableDeck = (rows: number, leadin = "") =>
  t.state.api.buildSlideDeck(`@slide[T]\n| name | value |\n| - | - |\n${Array.from({ length: rows }, (_, i) => `| row ${i} | x${i} |`).join("\n")}\n@end${leadin}\n`);
const rowsOn = (deck: any) =>
  deck.slides
    .flatMap((s: any) => s.body.filter((b: any) => b.type === "table"))
    .flatMap((tb: any) => tb.children.slice(1).map((r: any) => Number(/row (\d+)/.exec(JSON.stringify(r))![1])));

// Verifies REQ-231 (UC-25)
test("a table that fits a slide only without the @end() lead-in is not dropped", () => {
  for (let n = 1; n <= 40; n++) {
    const deck = tableDeck(n, "(Lead-in text under the table)");
    assert.deepEqual(rowsOn(deck), Array.from({ length: n }, (_, i) => i), `${n} rows`);
    assert.ok(!deck.diagnostics.some((d: any) => d.code === "drop-float" || d.severity === "error"), `${n} rows: ${JSON.stringify(deck.diagnostics.map((d: any) => d.code))}`);
    const last = deck.slides[deck.slides.length - 1];
    assert.ok(last.leadin, `${n} rows: the lead-in is on the last slide`);
    assert.ok(last.body.some((b: any) => b.type === "table"), `${n} rows: the table is on the slide with the lead-in`);
  }
});

// Verifies REQ-231 (UC-25)
test("the same holds for a table after text, and for a table with a caption", () => {
  for (let n = 1; n <= 30; n += 3) {
    const rows = Array.from({ length: n }, (_, i) => `| row ${i} | x${i} |`).join("\n");
    const deck = t.state.api.buildSlideDeck(`@slide[T]\nSome text before the table.\n\nTable: A caption {#tbl:a}\n| name | value |\n| - | - |\n${rows}\n@end(Lead-in)\n`);
    assert.deepEqual(rowsOn(deck), Array.from({ length: n }, (_, i) => i), `${n} rows`);
    assert.ok(!deck.diagnostics.some((d: any) => d.code === "drop-float"), `${n} rows`);
  }
});

const scaleOf = (s: any) => s.tableScale as number | undefined;
const tableSlides = (deck: any) => deck.slides.filter((s: any) => s.body.some((b: any) => b.type === "table"));

// Verifies REQ-232 (UC-25)
test("a table starts at 0.9 and shrinks in steps of 0.05 to no less than 0.6 to fit", () => {
  assert.equal(TABLE_SCALE_DEFAULT, 0.9);
  assert.equal(TABLE_SCALE_MIN, 0.6);
  assert.equal(TABLE_SCALE_STEP, 0.05);
  const allowed = [0.9, 0.85, 0.8, 0.75, 0.7, 0.65, 0.6];
  const seen = new Set<number>();
  let previous = 1;
  for (let n = 1; n <= 13; n++) {
    const slides = tableSlides(tableDeck(n));
    assert.equal(slides.length, 1, `${n} rows on one slide`);
    const s = scaleOf(slides[0])!;
    assert.ok(allowed.some((a) => Math.abs(a - s) < 1e-9), `${n} rows: ${s}`);
    assert.ok(s <= previous + 1e-9, `${n} rows: the scale never grows with more rows`);
    previous = s;
    seen.add(s);
  }
  assert.equal(scaleOf(tableSlides(tableDeck(2))[0]), 0.9);
  assert.equal(previous, 0.6, "thirteen rows only fit at the minimum");
  assert.ok(seen.size >= 3, `intermediate steps are used: ${[...seen]}`);
});

// Verifies REQ-232 (UC-25)
test("the slide carries the factor to the stylesheet, and the stylesheet applies it to the table", () => {
  const deck = tableDeck(10);
  const s = scaleOf(deck.slides[0])!;
  const h = t.state.ssr.renderToStaticMarkup(t.state.api.renderSlide(deck.slides[0], deck.render));
  assert.match(h, new RegExp(`--vfm-table-scale:${s}`));
  const sheet = css("slides/slides.css");
  assert.match(sheet, /\.vfm-slide table \{[^}]*font-size: calc\(var\(--vfm-table-scale, 0\.9\) \* 1em\)/s);
  // A slide without a table carries no factor.
  const plain = t.state.api.buildSlideDeck("@slide[T]\nText.\n@end\n");
  assert.equal(scaleOf(plain.slides[0]), undefined);
  assert.doesNotMatch(t.state.ssr.renderToStaticMarkup(t.state.api.renderSlide(plain.slides[0], plain.render)), /--vfm-table-scale/);
});

// Verifies REQ-234 (UC-25)
test("the caption is divided by the same factor, so it keeps the size of the text around it", () => {
  const sheet = css("slides/slides.css");
  assert.match(sheet, /\.vfm-slide table caption \{[^}]*font-size: calc\(1em \/ var\(--vfm-table-scale, 0\.9\)\)/s);
});

// Verifies REQ-233, REQ-012 (UC-25)
test("a table too big at 0.6 is split by rows, each slide holding as many rows as fit at 0.6", () => {
  const deck = tableDeck(80, "(Lead-in)");
  const slides = tableSlides(deck);
  assert.ok(slides.length > 1);
  slides.slice(0, -1).forEach((s: any) => assert.equal(scaleOf(s), 0.6));
  const counts = slides.map((s: any) => s.body.find((b: any) => b.type === "table").children.length - 1);
  assert.equal(counts[0], counts[1], "full slides hold the same number of rows");
  assert.ok(counts[counts.length - 1] <= counts[0]);
  assert.deepEqual(rowsOn(deck), Array.from({ length: 80 }, (_, i) => i));
});

// Verifies REQ-232, REQ-234 (UC-25)
test("the slide's table size rules beat the document's: on a slide the content sits inside .markdownBody", () => {
  // Specificity as (classes, elements): the rule on a slide must be stronger, not merely later, because the
  // bundle puts the document stylesheet after the slide stylesheet (a tie went to the document: no resizing).
  const spec = (selector: string): [number, number] => [(selector.match(/\.[\w-]+/g) ?? []).length, (selector.match(/(^|[\s>+~])[a-z][\w-]*/gi) ?? []).length];
  const wins = (a: [number, number], b: [number, number]) => a[0] > b[0] || (a[0] === b[0] && a[1] > b[1]);
  const slideSheet = css("slides/slides.css");
  const docSheet = css("CustomMarkdown.module.css");
  for (const element of ["table", "table caption"]) {
    const slideSel = new RegExp(`^([^{}/]*\\b${element.replace(" ", "\\s+")})\\s*\\{[^}]*font-size`, "m").exec(slideSheet)?.[1]?.trim();
    const docSel = new RegExp(`^(\\.markdownBody ${element})\\s*\\{[^}]*font-size`, "m").exec(docSheet)?.[1];
    assert.ok(slideSel && docSel, `${element}: both rules exist`);
    // The document's rule applies to the element as `.markdownBody <element>`.
    assert.ok(wins(spec(slideSel!), spec(docSel!)), `${element}: "${slideSel}" must out-rank "${docSel}"`);
  }
});

// Verifies REQ-235 (UC-25)
test("on a slide the cell padding and line height scale with the table text, and out-rank the document's", () => {
  const slideSheet = css("slides/slides.css");
  const docSheet = css("CustomMarkdown.module.css");
  const rule = /\.vfm-slide\.vfm-slide table th,\s*\.vfm-slide\.vfm-slide table td \{([^}]*)\}/.exec(slideSheet)?.[1];
  assert.ok(rule, "a slide rule for th and td exists");
  assert.match(rule!, /padding: [\d.]+em [\d.]+em/, "padding is in em, so it shrinks with the text");
  assert.doesNotMatch(rule!, /padding:[^;]*px/);
  assert.match(rule!, /line-height: 1\.3/);
  // The document's rule is `.markdownBody table th, .markdownBody table td` (classes 1, elements 2): ours must be stronger.
  assert.match(docSheet, /\.markdownBody table th,\s*\.markdownBody table td \{[^}]*padding: 6px 13px/s);
  // The document keeps its own pixel padding (REQ-151).
  assert.doesNotMatch(docSheet.replace(/\.markdownBody table th,\s*\.markdownBody table td \{[^}]*\}/s, ""), /table t[dh][^{]*\{[^}]*padding/);
});

// ─── Two tables on a 2col slide (UC-26) ──────────────────────────────────────

const tbl = (name: string) => `| ${name} | v |\n| - | - |\n| r0 | 1 |\n| r1 | 2 |`;
const tablesOf = (s: any) => [...s.body, ...s.images].filter((b: any) => b.type === "table");

// Verifies REQ-241 (UC-26)
test("two tables on a 2col slide with no text go side by side, one per column; a third starts a new slide", () => {
  const two = t.state.api.buildSlideDeck(`@slide[T](2col)\n${tbl("a")}\n\n${tbl("b")}\n@end\n`);
  assert.equal(two.slides.length, 1);
  assert.equal(two.slides[0].layout, "2col");
  assert.equal(tablesOf(two.slides[0]).length, 2);
  const h = t.state.ssr.renderToStaticMarkup(t.state.api.renderSlide(two.slides[0], two.render));
  assert.equal((h.match(/class="vfm-region vfm-images vfm-fit"/g) ?? []).length, 2, "one region per column");
  assert.equal((h.match(/<table/g) ?? []).length, 2);
  const three = t.state.api.buildSlideDeck(`@slide[T](2col)\n${tbl("a")}\n\n${tbl("b")}\n\n${tbl("c")}\n@end\n`);
  assert.deepEqual(three.slides.map((s: any) => tablesOf(s).length), [2, 1]);
  assert.ok(!three.diagnostics.some((d: any) => d.code === "drop-float" || d.severity === "error"));
});

// Verifies REQ-241 (UC-26)
test("a table and a picture, or the lone table, on a 2col slide behave as for pictures", () => {
  const mixed = t.state.api.buildSlideDeck(`@slide[T](2col)\n${tbl("a")}\n\n![Pic](a.png)\n@end\n`);
  assert.equal(mixed.slides.length, 1);
  assert.equal(mixed.slides[0].layout, "2col");
  const lone = t.state.api.buildSlideDeck(`@slide[T](2col)\n${tbl("a")}\n@end\n`);
  assert.equal(lone.slides[0].layout, "single", "one table takes the whole slide");
});

// Verifies REQ-242 (UC-26)
test("with text, or in another layout, a second table still goes to the next slide", () => {
  const withText = t.state.api.buildSlideDeck(`@slide[T](2col)\nIntro.\n\n${tbl("a")}\n\n${tbl("b")}\n@end\n`);
  assert.equal(withText.slides.length, 2);
  assert.ok(withText.slides.every((s: any) => tablesOf(s).length <= 1));
  for (const layout of ["", "(rtext)", "(ltext)"]) {
    const deck = t.state.api.buildSlideDeck(`@slide[T]${layout}\n${tbl("a")}\n\n${tbl("b")}\n@end\n`);
    assert.equal(deck.slides.length, 2, layout || "single");
  }
});

// Verifies REQ-243 (UC-26)
test("two tables that do not fit side by side go to separate slides rather than being dropped", () => {
  // A measurer that accepts a 2col slide only when no table has more than 1 body row (the stand-in for 'too wide').
  const deck = t.state.api.buildSlideDeck(`@slide[T](2col)\n${tbl("a")}\n\n${tbl("b")}\n@end\n`, {
    measure: (slide: any) => slide.layout !== "2col" || tablesOf(slide).every((b: any) => b.children.length <= 2),
  });
  assert.equal(deck.slides.length, 2);
  assert.deepEqual(deck.slides.map((s: any) => tablesOf(s).length), [1, 1]);
  assert.ok(!deck.diagnostics.some((d: any) => d.code === "drop-float" || d.severity === "error"));
  assert.ok(deck.slides.every((s: any) => s.layout === "single"));
});
