import { test } from "node:test";
import assert from "node:assert/strict";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkCitations from "../plugins/citations.ts";
import { resolveBibliography, type BibEntry } from "../bibliography.ts";

const bib: Record<string, BibEntry> = {
  shannon1948: { citeKey: "shannon1948", entryType: "article", fields: { title: "A Theory", journal: "BSTJ", year: "1948" }, authors: ["Shannon, Claude E."], editors: [] },
  math2020: { citeKey: "math2020", entryType: "article", fields: { title: "Sorting $n$ Items in $O(n \\log n)$ Time", journal: "J", year: "2020" }, authors: ["Doe, Jane"], editors: [] },
  Knuth1997: { citeKey: "Knuth1997", entryType: "book", fields: { title: "TAOCP", year: "1997" }, authors: ["Knuth, Donald E."], editors: [] },
};
const resolver = async (key: string) => bib[key] ?? null;

/** Collects the cited keys, resolves them, then runs the plugin again and returns the tree. */
async function run(markdown: string, config: object = {}) {
  const probe = unified().use(remarkParse).use(remarkCitations, {});
  const probeFile: any = { data: {} };
  probe.runSync(probe.parse(markdown), probeFile);
  const citeKeys: string[] = probeFile.data.citeKeys;

  const bibliography = await resolveBibliography(citeKeys, resolver);
  const processor = unified().use(remarkParse).use(remarkCitations, { bibliography, config });
  const tree: any = processor.parse(markdown);
  processor.runSync(tree, { data: {} } as any);
  return { tree, citeKeys };
}

/** The visible text of a node, with links shown as <label>. */
function text(node: any): string {
  if (node.type === "text" || node.type === "inlineCode") return node.value;
  if (node.type === "html") return node.value.replace(/<[^>]+>/g, "");
  return (node.children ?? []).map(text).join("");
}
const paragraph = (tree: any) => text(tree.children[0]);
const referenceItems = (tree: any): string[] => {
  const list = tree.children.find((n: any) => n.type === "list");
  return list ? list.children.map(text) : [];
};

test("records cited keys in order of first appearance, once each", async () => {
  const { citeKeys } = await run("@cite(b) @cite(a, b) @cite(c)");
  assert.deepEqual(citeKeys, ["b", "a", "c"]);
});

test("a citation becomes a linked author-year, and the entry is listed once", async () => {
  const { tree } = await run("See @cite(shannon1948) and again @cite(shannon1948).");
  assert.equal(paragraph(tree), "See (Shannon, 1948) and again (Shannon, 1948).");
  const items = referenceItems(tree);
  assert.equal(items.length, 1);
  assert.match(items[0], /^Shannon, C\. E\. \(1948\)\. A Theory\./);
});

test("math in a title becomes inlineMath nodes in the reference list", async () => {
  const { tree } = await run("@cite(math2020)");
  const item = tree.children.find((n: any) => n.type === "list").children[0];
  const math: string[] = [];
  const walk = (n: any) => (n.type === "inlineMath" ? math.push(n.value) : (n.children ?? []).forEach(walk));
  walk(item);
  assert.deepEqual(math, ["n", "O(n \\log n)"]);
  assert.match(text(item), /Sorting .* Items in .* Time/);
});

test("keys are case-sensitive", async () => {
  const { tree } = await run("@cite(Knuth1997) and @cite(knuth1997)");
  assert.equal(paragraph(tree), "(Knuth, 1997) and (unknown citation: knuth1997)");
  assert.equal(referenceItems(tree).length, 1);
});

test("an unknown key is red text inside the usual brackets, with none of its own", async () => {
  const apa = await run("A @cite(nope) B @cite(shannon1948, nope)");
  assert.equal(paragraph(apa.tree), "A (unknown citation: nope) B (Shannon, 1948; unknown citation: nope)");
  const html = apa.tree.children[0].children.find((n: any) => n.type === "html");
  assert.match(html.value, /color:red/);

  const numbered = await run("A @cite(nope) B @cite(shannon1948, nope)", { referenceStyle: "vancouver" });
  assert.equal(paragraph(numbered.tree), "A [unknown citation: nope] B [1, unknown citation: nope]");
});

test("numbered citations follow the reference list order, lowest first", async () => {
  const { tree } = await run("@cite(Knuth1997, shannon1948)", { referenceStyle: "vancouver" });
  assert.equal(paragraph(tree), "[1, 2]");
});

test("code and the tree are left alone when no bibliography is given", () => {
  const processor = unified().use(remarkParse).use(remarkCitations, {});
  const tree: any = processor.parse("`@cite(x)` and @cite(y)");
  const file: any = { data: {} };
  processor.runSync(tree, file);
  assert.deepEqual(file.data.citeKeys, ["y"]);
  assert.equal(paragraph(tree), "@cite(x) and @cite(y)");
});

test("while entries are pending, citations are placeholders and there is no list", async () => {
  const processor = unified().use(remarkParse).use(remarkCitations, { pending: true });
  const tree: any = processor.parse("@cite(a)");
  processor.runSync(tree, { data: {} } as any);
  assert.equal(paragraph(tree), "(…)");
  assert.deepEqual(referenceItems(tree), []);
});
