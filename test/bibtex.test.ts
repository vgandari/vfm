import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBibTeX } from "../bibtex.ts";

const SOURCE = `
@string{bstj = "Bell System Technical Journal"}
@inproceedings{Child2020, author={Doe, Jane}, title={A Paper}, crossref={proc2020}, pages={1--10}}
@proceedings{proc2020, title={Proceedings of Things}, editor={Roe, Rick and Poe, Pat}, publisher={ACM},
  location={New York}, date={2020-05-01}, series={LNCS}, volume={12}, doi={10.1/proc}}
@article{a1, author={X, Y}, title={T}, journaltitle=bstj, date={1999-12-31/2000-01-02}}
@article{a2, title={T}, journaltitle={J2}, journal={Real}, year={2001}, date={2020-05}, location={L}, address={Addr}}
@article{a3, title={T}, crossref={per}}
@periodical{per, title={The Periodical}, year=2005}
@inbook{ch, title={Chapter}, crossref={bk}}
@book{bk, author={Auth, Ann}, editor={Ed, Eve}, title={The Book}, year={1990}, month=mar}
@inproceedings{orphan, title={O}, crossref={nope}}
@misc{loopA, crossref={loopB}, title={A}}
@misc{loopB, crossref={loopA}, title={B}, note={n}}
@misc{self, crossref={self}, title={S}}
@misc{foo, title={x}}
@misc{foo, title={dup}}
@misc{Foo, title={differs only in case}}
@inproceedings{own, title={Own}, year={2019}, crossref={proc2020}}
@misc{dated, date={2021-07}, title={D}}
@misc{bad, date={in press}, title={B}}
`;
const { entries, errors, warnings } = parseBibTeX(SOURCE);
const entry = (key: string) => entries.find((e) => e.citeKey === key)!;

test("crossref: a child inherits what it lacks, from a parent that comes later", () => {
  const c = entry("Child2020");
  assert.equal(c.fields.booktitle, "Proceedings of Things");
  assert.equal(c.fields.publisher, "ACM");
  assert.equal(c.fields.address, "New York");
  assert.equal(c.fields.year, "2020");
  assert.equal(c.fields.month, "May");
  assert.equal(c.fields.series, "LNCS");
  assert.equal(c.fields.title, "A Paper");
  assert.equal(c.fields.pages, "1--10");
  assert.equal(c.fields.doi, undefined, "the parent's DOI is not the child's");
  assert.deepEqual(c.editors, ["Roe, Rick", "Poe, Pat"]);
  assert.deepEqual(c.authors, ["Doe, Jane"]);
  assert.equal(c.fields.crossref, "proc2020", "the field itself is kept");
});

test("crossref: a child with its own year keeps its own date", () => {
  assert.equal(entry("own").fields.year, "2019");
  assert.equal(entry("own").fields.month, undefined);
});

test("crossref: periodical title becomes journal; inbook inherits the author", () => {
  assert.equal(entry("a3").fields.journal, "The Periodical");
  assert.equal(entry("ch").fields.booktitle, "The Book");
  assert.deepEqual(entry("ch").authors, ["Auth, Ann"]);
  assert.deepEqual(entry("ch").editors, ["Ed, Eve"]);
});

test("biblatex aliases fill only what is missing, and keep the original", () => {
  assert.equal(entry("a1").fields.journal, "Bell System Technical Journal");
  assert.equal(entry("a1").fields.journaltitle, "Bell System Technical Journal");
  assert.equal(entry("a1").fields.year, "1999");
  assert.equal(entry("a1").fields.month, "December");
  assert.equal(entry("a2").fields.journal, "Real");
  assert.equal(entry("a2").fields.year, "2001");
  assert.equal(entry("a2").fields.month, undefined);
  assert.equal(entry("a2").fields.address, "Addr");
  assert.equal(entry("dated").fields.month, "July");
  assert.equal(entry("bad").fields.year, undefined);
});

test("a bad crossref is a warning and the entry is kept", () => {
  const text = warnings.map((w) => w.message).join("\n");
  assert.match(text, /'orphan' has crossref 'nope'/);
  assert.match(text, /crossref cycle/);
  assert.equal(warnings.length, 3, text);
  assert.ok(entries.some((e) => e.citeKey === "orphan"));
});

test("a repeated cite key is an error, but keys that differ in case are distinct", () => {
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /duplicate cite key 'foo'/);
  assert.ok(entry("foo") && entry("Foo"));
});

test("crossref keys are case-sensitive", () => {
  const { entries, warnings } = parseBibTeX("@misc{c, title={C}, crossref={Parent}}\n@proceedings{parent, title={P}, publisher={Pub}}");
  assert.equal(entries.find((e) => e.citeKey === "c")!.fields.publisher, undefined);
  assert.match(warnings[0].message, /crossref 'Parent'/);
});

test("any entry type and field name is kept", () => {
  const { entries } = parseBibTeX("@dataset{d, title={T}, weirdfield={w}}");
  assert.equal(entries[0].entryType, "dataset");
  assert.equal(entries[0].fields.weirdfield, "w");
});

test("an @ in a %-comment line is not an entry, and a commented-out entry is ignored", () => {
  const { entries, errors } = parseBibTeX(`
% a note about @inbook and @cite(x) that is just prose
  % @article{hidden, title={Commented out}}
@misc{shown, title={Shown}}
`);
  assert.deepEqual(entries.map((e) => e.citeKey), ["shown"]);
  assert.equal(errors.length, 0);
});

test("each entry keeps its text as written in rawSource", () => {
  const text = "@string{j = \"Journal\"}\n\n@article{a, title={A}, journal=j}\n% a comment\n@book(b, title = {B})\n";
  const { entries } = parseBibTeX(text);
  assert.equal(entries[0].rawSource, "@article{a, title={A}, journal=j}", "macros stay unexpanded");
  assert.equal(entries[0].fields.journal, "Journal", "but the fields are expanded");
  assert.equal(entries[1].rawSource, "@book(b, title = {B})");
});
