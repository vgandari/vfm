import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BibEntryValidationError,
  cleanLatex,
  createFetchResolver,
  fetchBibEntry,
  formatReference,
  isBibEntry,
  ReferenceStyle,
  resolveBibliography,
  splitMath,
  validateBibEntry,
  type BibEntry,
} from "../bibliography.ts";

const STYLES = [ReferenceStyle.APA, ReferenceStyle.MLA, ReferenceStyle.Vancouver];

const entry = (entryType: string, fields: Record<string, string>): BibEntry => ({
  citeKey: "k",
  entryType,
  fields,
  authors: fields.author ? fields.author.split(" and ") : [],
  editors: fields.editor ? fields.editor.split(" and ") : [],
});
const render = (e: BibEntry, style: ReferenceStyle) =>
  formatReference(e, style).segments.map((s) => s.text).join("");

// ─── validation ───────────────────────────────────────────────────────────────

const valid = { citeKey: "k", entryType: "Article", fields: { Title: "T", year: "1948" }, authors: ["A, B"], editors: [] };

test("validateBibEntry accepts an entry and normalises case", () => {
  const v = validateBibEntry(valid);
  assert.equal(v.entryType, "article");
  assert.equal(v.fields.title, "T");
});

test("validateBibEntry names the first problem", () => {
  const cases: [unknown, RegExp][] = [
    [null, /entry must be an object/],
    [{ ...valid, citeKey: "" }, /citeKey/],
    [{ ...valid, entryType: 5 }, /entryType/],
    [{ ...valid, fields: null }, /fields must/],
    [{ ...valid, fields: { year: 1948 } }, /fields\.year/],
    [{ ...valid, authors: "A" }, /authors/],
    [{ ...valid, editors: [1] }, /editors\[0\]/],
    [{ citeKey: "k", entryType: "misc" }, /fields/],
  ];
  for (const [value, re] of cases) {
    assert.throws(() => validateBibEntry(value), (e: unknown) => e instanceof BibEntryValidationError && re.test(e.message));
  }
  assert.ok(isBibEntry(valid));
  assert.ok(!isBibEntry({}));
});

const respond = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;

test("fetchBibEntry rejects a bad body or a different key, and maps 404 to null", async () => {
  assert.equal((await fetchBibEntry("k", "/api/bib", respond(valid))).citeKey, "k");
  await assert.rejects(fetchBibEntry("other", "/api/bib", respond(valid)), /requested/);
  await assert.rejects(fetchBibEntry("K", "/api/bib", respond(valid)), /requested/, "case matters");
  await assert.rejects(fetchBibEntry("k", "/api/bib", respond({ nope: 1 })), /Invalid bibliography entry/);
  assert.equal(await fetchBibEntry("k", "/api/bib", respond({}, 404)), null);
});

// ─── cite keys ────────────────────────────────────────────────────────────────

test("resolveBibliography resolves each key once, and Foo and foo are different keys", async () => {
  const calls: string[] = [];
  const map = await resolveBibliography(["Foo", "foo", "Foo"], async (k) => {
    calls.push(k);
    return k === "foo" ? entry("misc", {}) : null;
  });
  assert.deepEqual(calls.sort(), ["Foo", "foo"]);
  assert.equal(map.get("Foo"), null);
  assert.ok(map.get("foo"));
});

test("createFetchResolver caches per key, case-sensitively", async () => {
  let fetches = 0;
  const resolver = createFetchResolver("/api/bib", (async (url: string) => {
    fetches++;
    return new Response(JSON.stringify({ ...valid, citeKey: decodeURIComponent(url.split("/").pop()!) }));
  }) as unknown as typeof fetch);
  await resolver("Foo");
  await resolver("Foo");
  await resolver("foo");
  assert.equal(fetches, 2);
});

// ─── math ─────────────────────────────────────────────────────────────────────

test("cleanLatex leaves $...$ math as written and cleans the text around it", () => {
  assert.equal(cleanLatex("An $O(n \\log n)$ \\emph{algorithm} for {TeX}"), "An $O(n \\log n)$ algorithm for TeX");
  assert.equal(cleanLatex("$\\alpha_{i}$ and $x^{2}$"), "$\\alpha_{i}$ and $x^{2}$");
  assert.equal(cleanLatex("It costs \\$5"), "It costs $5", "an escaped dollar is just a dollar");
});

test("splitMath separates math from text", () => {
  assert.deepEqual(splitMath("Sorting $n$ items in $O(n)$ time"), [
    { math: false, value: "Sorting " },
    { math: true, value: "$n$" },
    { math: false, value: " items in " },
    { math: true, value: "$O(n)$" },
    { math: false, value: " time" },
  ]);
  assert.deepEqual(splitMath("It costs \\$5 or \\$6"), [{ math: false, value: "It costs \\$5 or \\$6" }]);
  assert.deepEqual(splitMath(""), []);
});

test("a title with math reaches the formatted reference intact", () => {
  const e = entry("article", { author: "Doe, Jane", title: "Sorting $n$ Items in $O(n \\log n)$ Time", journal: "J", year: "2020" });
  for (const style of STYLES) assert.match(render(e, style), /Sorting \$n\$ Items in \$O\(n \\log n\)\$ Time/, style);
});

// ─── formatting: entry types ──────────────────────────────────────────────────

const FULL = {
  author: "Doe, Jane and Roe, Rick", editor: "Poe, Pat", title: "The Title", journal: "J. Things", booktitle: "Book Title",
  publisher: "Pub", address: "City", school: "Uni", institution: "Inst", organization: "Org", howpublished: "Web",
  year: "2020", month: "May", volume: "3", number: "4", pages: "1--10", chapter: "7", edition: "Second", series: "Ser",
  type: "Kind", note: "A note", doi: "10.1/x", url: "https://x.org", urldate: "2021-01-01", eprint: "1234",
  eprinttype: "arXiv", version: "2.1", holder: "Holder Inc.",
};

test("biblatex and web types use the matching BibTeX layout", () => {
  for (const style of STYLES) {
    assert.equal(render(entry("report", FULL), style), render(entry("techreport", FULL), style), `report/${style}`);
    assert.equal(render(entry("electronic", FULL), style), render(entry("online", FULL), style), `electronic/${style}`);
    assert.equal(render(entry("www", FULL), style), render(entry("online", FULL), style), `www/${style}`);
    assert.equal(render(entry("inbook", FULL), style), render(entry("incollection", FULL), style), `inbook+booktitle/${style}`);
  }
  const thesis = { ...FULL, type: "mathesis" };
  assert.match(render(entry("thesis", thesis), ReferenceStyle.APA), /Master's thesis/);
  assert.match(render(entry("thesis", FULL), ReferenceStyle.APA), /\[Kind\]/);
  const { type: _type, ...untyped } = FULL;
  assert.match(render(entry("thesis", untyped), ReferenceStyle.APA), /Doctoral dissertation/);
});

test("a biblatex thesis shows its institution as the school", () => {
  const thesis = entry("thesis", { author: "Doe, Jane", title: "T", institution: "Princeton University", year: "1938" });
  for (const style of STYLES) assert.match(render(thesis, style), /Princeton University/, style);
});

test("online entries show the access date", () => {
  const e = entry("online", { author: "Doe, Jane", title: "Page", publisher: "Site", year: "2020", month: "5", url: "https://x.org", urldate: "2021-01-02" });
  assert.equal(render(e, ReferenceStyle.APA), "Doe, J. (2020, May). Page. Site. Retrieved January 2, 2021, from https://x.org");
  assert.match(render(e, ReferenceStyle.MLA), /May 2020\. https:\/\/x\.org\. Accessed 2 Jan\. 2021\.$/);
  assert.match(render(e, ReferenceStyle.Vancouver), /\[Internet\]\..*\[cited 2021 Jan 2\]\. Available from: https:\/\/x\.org$/);
});

test("a book inbook shows chapter and pages; a plain book does not show pages", () => {
  const chapter = entry("inbook", { author: "Doe, Jane", title: "The Book", chapter: "7", pages: "10--20", year: "2020", publisher: "Pub" });
  assert.match(render(chapter, ReferenceStyle.APA), /\(Chap\. 7, pp\. 10–20\)/);
  assert.match(render(chapter, ReferenceStyle.MLA), /pp\. 10–20/);
  assert.doesNotMatch(render(entry("book", { title: "B", pages: "300" }), ReferenceStyle.APA), /300/);
});

test("books show their volume", () => {
  const book = entry("book", { title: "B", volume: "3", year: "2020" });
  assert.match(render(book, ReferenceStyle.APA), /\(Vol\. 3\)/);
  assert.match(render(book, ReferenceStyle.MLA), /\. Vol\. 3, 2020\./);
  assert.match(render(book, ReferenceStyle.Vancouver), /Vol\. 3\./);
});

test("software and datasets show their version and a type tag", () => {
  const software = entry("software", { author: "Hipp, D. Richard", title: "SQLite", version: "3.45.0", year: "2024", publisher: "Pub" });
  assert.equal(render(software, ReferenceStyle.APA), "Hipp, D. R. (2024). SQLite (Version 3.45.0) [Computer software]. Pub.");
  assert.match(render(software, ReferenceStyle.MLA), /SQLite\. Version 3\.45\.0, Pub, 2024\./);
  assert.match(render(software, ReferenceStyle.Vancouver), /SQLite \[software\]\. Version 3\.45\.0\. Pub; 2024\./);
  const data = entry("dataset", { title: "Data", year: "2020" });
  assert.match(render(data, ReferenceStyle.APA), /\[Data set\]/);
  assert.match(render(data, ReferenceStyle.Vancouver), /\[dataset\]/);
});

test("patents show their number, country and holder", () => {
  const patent = entry("patent", { author: "Bardeen, John", title: "Circuit Element", number: "2,524,035", location: "US", address: "US", holder: "Bell Labs", year: "1950", month: "10", date: "1950-10-03" });
  assert.match(render(patent, ReferenceStyle.APA), /\(US Patent No\. 2,524,035\)\. Bell Labs\./);
  assert.match(render(patent, ReferenceStyle.MLA), /US Patent No\. 2,524,035, Bell Labs, 3 Oct\. 1950\./);
  assert.match(render(patent, ReferenceStyle.Vancouver), /US Patent 2,524,035\. Assignee: Bell Labs\. 1950 Oct 3\./);
});

test("an eprint is shown, and linked for arXiv, only when there is no DOI", () => {
  const preprint = entry("article", { author: "Kingma, Diederik", title: "Adam", year: "2014", eprint: "1412.6980", eprinttype: "arXiv" });
  for (const style of STYLES) assert.match(render(preprint, style), /arXiv:1412\.6980/, style);
  const link = formatReference(preprint, ReferenceStyle.APA).segments.find((x) => x.text.startsWith("arXiv:"));
  assert.equal(link?.href, "https://arxiv.org/abs/1412.6980");
  const withDoi = entry("article", { title: "T", eprint: "1412.6980", doi: "10.1/x" });
  assert.doesNotMatch(render(withDoi, ReferenceStyle.APA), /arXiv/);
});

test("a chapter or paper in an edited book shows edition and volume", () => {
  const paper = entry("incollection", { author: "A, B", title: "T", booktitle: "Book", editor: "E, F", edition: "2nd", volume: "3", pages: "1--9", publisher: "P", year: "2020" });
  assert.match(render(paper, ReferenceStyle.APA), /\(2nd ed\., Vol\. 3, pp\. 1–9\)/);
  assert.match(render(paper, ReferenceStyle.MLA), /2nd ed\., vol\. 3, P, 2020, pp\. 1–9/);
  assert.match(render(paper, ReferenceStyle.Vancouver), /2nd ed\. Vol\. 3\./);
});

// ─── names ────────────────────────────────────────────────────────────────────

test("APA puts a comma before the ampersand, even for two authors", () => {
  const two = entry("book", { author: "Bardeen, John and Brattain, Walter H.", title: "T", year: "1950" });
  assert.match(render(two, ReferenceStyle.APA), /^Bardeen, J\., & Brattain, W\. H\. \(1950\)/);
  assert.equal(formatReference(two, ReferenceStyle.APA).author, "Bardeen & Brattain", "in-text keeps no comma");
});

test('"Last, Jr, First" keeps the suffix', () => {
  const book = entry("book", { author: "King, Jr., Martin Luther", title: "Why We Can't Wait", year: "1964" });
  assert.match(render(book, ReferenceStyle.APA), /^King, M\. L\., Jr\. \(1964\)/);
  assert.match(render(book, ReferenceStyle.MLA), /^King, Martin Luther, Jr\./);
  assert.match(render(book, ReferenceStyle.Vancouver), /^King ML Jr\./);
  assert.equal(formatReference(book, ReferenceStyle.APA).author, "King");
});

test('"First von Last" starts the family name at the first lowercase word', () => {
  const family = (author: string) => formatReference(entry("misc", { author, title: "T" }), ReferenceStyle.APA).author;
  assert.equal(family("Pablo de Roda Gil"), "de Roda Gil");
  assert.equal(family("Ludwig Mies van der Rohe"), "van der Rohe");
  assert.equal(family("Ludwig van Beethoven"), "van Beethoven");
  assert.equal(family("Jane Doe"), "Doe");
  assert.equal(family("van Gogh, Vincent"), "van Gogh");
});

// ─── formatting: dates ────────────────────────────────────────────────────────

test("month is shown (and the day, when the date field has it)", () => {
  const article = entry("article", { author: "Doe, Jane", title: "T", journal: "J", year: "2020", month: "may", volume: "3", date: "2020-05-17" });
  assert.match(render(article, ReferenceStyle.APA), /\(2020\)\./, "APA dates journal articles by year alone");
  assert.match(render(article, ReferenceStyle.MLA), /17 May 2020/);
  assert.match(render(article, ReferenceStyle.Vancouver), /2020 May 17;3/);
  const web = entry("misc", { title: "T", year: "2020", date: "2020-05-17" });
  assert.match(render(web, ReferenceStyle.APA), /\(2020, May 17\)/);
});

test("a month without a year is ignored", () => {
  assert.doesNotMatch(render(entry("article", { title: "T", month: "May" }), ReferenceStyle.MLA), /May/);
});

// ─── formatting: missing fields and odd data ──────────────────────────────────

const ALL_TYPES = [
  "article", "book", "booklet", "conference", "inbook", "incollection", "inproceedings", "manual", "mastersthesis",
  "misc", "phdthesis", "proceedings", "techreport", "unpublished", "online", "report", "thesis", "patent",
  "dataset", "software", "electronic", "www", "periodical", "unknowntype",
];
const BAD_TEXT = /undefined|null|NaN|\(\)|, ,|\.\.|\( |,\.|\s,|\[\]/;

test("removing any one field, or all of them, never throws or leaves debris", () => {
  for (const type of ALL_TYPES) {
    for (const style of STYLES) {
      const variants: [string, Record<string, string>][] = [
        ["no fields", {}],
        ...Object.keys(FULL).map((k): [string, Record<string, string>] => [
          `without ${k}`,
          Object.fromEntries(Object.entries(FULL).filter(([name]) => name !== k)),
        ]),
      ];
      for (const [label, fields] of variants) {
        const text = render(entry(type, fields), style);
        assert.doesNotMatch(text, BAD_TEXT, `${type}/${style}/${label}: ${JSON.stringify(text)}`);
      }
    }
  }
});

test("an entry with neither title nor names leads with its cite key", () => {
  for (const style of STYLES) assert.match(render(entry("misc", {}), style), /^\[k\]/);
  assert.equal(render(entry("misc", { title: "T" }), ReferenceStyle.MLA).startsWith("[k]"), false);
});

test('a name list that is only "and others" does not throw', () => {
  for (const style of STYLES) {
    for (const names of [["others"], ["{}"], [","], ["Doe, Jane", "others"]]) {
      const asAuthors = { ...entry("inproceedings", { title: "T", booktitle: "B", year: "2020" }), authors: names };
      const asEditors = { ...entry("inproceedings", { title: "T", booktitle: "B", year: "2020" }), authors: ["A, B"], editors: names };
      for (const e of [asAuthors, asEditors]) {
        assert.doesNotMatch(render(e, style), /(^|\s),\s*et al|edited by\s*[,.]/, JSON.stringify(names));
        assert.doesNotMatch(render(e, style), /could not be formatted/);
      }
    }
  }
});
