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
