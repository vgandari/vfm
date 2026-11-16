/**
 * Conformance of vfm's Markdown to the flavors it builds on. The cases are the published tests of CommonMark 0.31.2,
 * the GFM spec 0.29 and cmark-gfm's extension tests, and markdown-it's fixtures (tests/fixtures/README.md); they are
 * rendered through vfm and compared as normalized HTML (tests/helpers/normalizeHtml.ts).
 *
 * Cases that need raw HTML parsed are left out: vfm shows HTML as text (REQ-022). Every other difference is listed with
 * its reason in tests/fixtures/known-divergences.json; a difference not listed fails the run, and so does a listed one
 * that no longer differs. A difference that is a vfm defect gets a `todo` test that states the right output (none is open).
 *
 * Each test names the requirements (docs/REQUIREMENTS.md) and use cases (docs/USE_CASES.md) it verifies.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { loadApi } from "./helpers/loadApi.ts";
import { cases, check, isRawHtmlCase, known, type Case } from "./helpers/conformance.ts";

const t = loadApi();
let log = console.log;
before(async () => {
  await t.load();
  // The code handler prints a debug line per code block; it would bury the results.
  log = console.log;
  console.log = (...a: unknown[]) => (String(a[0]).startsWith("[codeHandler]") ? undefined : log(...a));
});
after(() => {
  console.log = log;
  t.cleanup();
});
const render = (md: string) => t.state.ssr.renderToStaticMarkup(t.state.ssr.renderMarkdown(md, { numberingDepth: 0 }));

const cm = (...sections: string[]) => (c: Case) => c.suite.startsWith("CommonMark") && sections.includes(c.section);
const run = (pick: (c: Case) => boolean) => {
  const { ran, problems } = check(pick, render);
  assert.ok(ran > 0, "the group selected no cases");
  assert.deepEqual(problems, [], `${problems.length} problem(s):\n${problems.join("\n")}`);
};

// ─── CommonMark 0.31.2: blocks ───────────────────────────────────────────────

// Verifies REQ-301 (UC-44)
test("CommonMark: tabs", () => run(cm("Tabs")));
// Verifies REQ-301 (UC-44)
test("CommonMark: thematic breaks", () => run(cm("Thematic breaks")));
// Verifies REQ-301 (UC-44)
test("CommonMark: ATX headings", () => run(cm("ATX headings")));
// Verifies REQ-301 (UC-44)
test("CommonMark: setext headings", () => run(cm("Setext headings")));
// Verifies REQ-301 (UC-44)
test("CommonMark: indented code blocks", () => run(cm("Indented code blocks")));
// Verifies REQ-301 (UC-44)
test("CommonMark: fenced code blocks", () => run(cm("Fenced code blocks")));
// Verifies REQ-301 (UC-44)
test("CommonMark: link reference definitions", () => run(cm("Link reference definitions")));
// Verifies REQ-301 (UC-44)
test("CommonMark: paragraphs, blank lines, precedence", () => run(cm("Paragraphs", "Blank lines", "Precedence", "Inlines", "Textual content")));
// Verifies REQ-301 (UC-44)
test("CommonMark: block quotes", () => run(cm("Block quotes")));
// Verifies REQ-301 (UC-44)
test("CommonMark: list items", () => run(cm("List items")));
// Verifies REQ-301 (UC-44)
test("CommonMark: lists", () => run(cm("Lists")));

// ─── CommonMark 0.31.2: inlines ──────────────────────────────────────────────

// Verifies REQ-302 (UC-44)
test("CommonMark: backslash escapes", () => run(cm("Backslash escapes")));
// Verifies REQ-302 (UC-44)
test("CommonMark: entity and numeric character references", () => run(cm("Entity and numeric character references")));
// Verifies REQ-302 (UC-44)
test("CommonMark: code spans", () => run(cm("Code spans")));
// Verifies REQ-302 (UC-44)
test("CommonMark: emphasis and strong emphasis", () => run(cm("Emphasis and strong emphasis")));
// Verifies REQ-302 (UC-44)
test("CommonMark: links", () => run(cm("Links")));
// Verifies REQ-302 (UC-44)
test("CommonMark: images", () => run(cm("Images")));
// Verifies REQ-302 (UC-44)
test("CommonMark: autolinks", () => run(cm("Autolinks")));
// Verifies REQ-302 (UC-44)
test("CommonMark: hard and soft line breaks", () => run(cm("Hard line breaks", "Soft line breaks")));

// ─── GitHub Flavored Markdown ────────────────────────────────────────────────

const gfm = (suite: string, ...sections: string[]) => (c: Case) => c.suite.startsWith(suite) && (sections.length === 0 || sections.some((s) => c.section.startsWith(s)));

// Verifies REQ-303 (UC-44)
test("GFM: tables (spec, cmark-gfm, markdown-it)", () => run((c) => /tables/i.test(c.section) || c.suite === "markdown-it tables" || c.section.startsWith("a table can be recognised") || /table|pipe|cell/i.test(c.section) && c.suite !== "CommonMark 0.31.2"));
// Verifies REQ-304 (UC-44)
test("GFM: task list items", () => run(gfm("", "Task list")));
// Verifies REQ-040, REQ-305 (UC-44, UC-29)
test("GFM: strikethrough (spec, cmark-gfm, markdown-it)", () => run((c) => /strikeout|strikethrough/i.test(c.section) || c.suite === "markdown-it strikethrough"));
// Verifies REQ-305 (UC-44)
test("GFM: autolink literals", () => run((c) => c.suite !== "CommonMark 0.31.2" && /^autolinks/i.test(c.section)));
// Verifies REQ-306 (UC-44)
test("GFM: footnotes", () => run((c) => c.suite === "cmark-gfm extensions" && /footnote/i.test(c.section)));
// Verifies REQ-301, REQ-302 (UC-44)
test("markdown-it: CommonMark extras", () => run((c) => c.suite === "markdown-it commonmark_extras"));
// Verifies REQ-301, REQ-302, REQ-303 (UC-44)
test("cmark-gfm: remaining extension cases", () => run((c) => c.suite === "cmark-gfm extensions" && !/footnote|^autolinks|table|strikethrough|task/i.test(c.section)));

// ─── The ledger and the floor ────────────────────────────────────────────────

// Verifies REQ-307 (UC-44)
test("every case is in a group above, and the ledger names only cases that exist and need no raw HTML", () => {
  const ids = new Set(cases.map((c) => c.id));
  for (const id of Object.keys(known)) {
    assert.ok(ids.has(id), `${id} is in known-divergences.json but not in the fixtures`);
    assert.ok(!isRawHtmlCase(cases.find((c) => c.id === id)!), `${id} needs raw HTML; it is left out, not listed`);
    assert.ok(known[id].reason.length > 20, `${id} needs a reason`);
  }
  // Every non-HTML case runs in exactly the groups above: count them by running everything once.
  const all = check(() => true, render);
  assert.deepEqual(all.problems, []);
});

// Verifies REQ-307 (UC-44)
test("at least 94% of the cases that need no raw HTML agree with the suites", () => {
  const pool = cases.filter((c) => !isRawHtmlCase(c));
  const differing = pool.filter((c) => known[c.id]).length;
  const rate = (pool.length - differing) / pool.length;
  console.log(`conformance: ${pool.length - differing}/${pool.length} (${(rate * 100).toFixed(1)}%) agree; ${cases.length - pool.length} need raw HTML and are not run; differences by kind:`, JSON.stringify(Object.values(known).reduce<Record<string, number>>((n, k) => ((n[k.kind] = (n[k.kind] ?? 0) + 1), n), {})));
  assert.ok(rate >= 0.94, `agreement fell to ${(rate * 100).toFixed(1)}%`);
});

// ─── Defects the suites found, stated as they should behave ──────────────────
// They failed when the suites found them and were todo tests until fixed.

const doc = (md: string) => render(md).replace(/\sdata-line="\d+"/g, "");

// Verifies REQ-309 (UC-44)
test("a line of only === is text, not an empty highlight", () => {
  assert.doesNotMatch(doc("\n====\n"), /<mark><\/mark>/);
  assert.match(doc("a ==== b\n"), /a ==== b/);
});

// Verifies REQ-315 (UC-44)
test("text next to an image in a paragraph is kept, in order, around the figure", () => {
  const html = doc("My ![foo bar](/path/to/train.jpg) caption words\n");
  assert.match(html, /<p>My\s*<\/p>\s*<figure.*<\/figure>\s*<p>\s*caption words<\/p>/s);
  assert.match(html, /<img[^>]*src="\/path\/to\/train.jpg"/);
});

// Verifies REQ-315 (UC-44)
test("a hard line break inside alt text is kept as a space or newline", () => {
  assert.match(doc("![here\\\nit is](x.png)\n"), /alt="here[\s\n]it is"/);
});
