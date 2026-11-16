/**
 * Reduces an HTML fragment to a canonical string so vfm's output can be compared with the HTML that the
 * CommonMark, GFM and markdown-it suites expect. It removes what vfm adds on purpose and nothing that
 * changes what a reader sees: the differences it hides are listed in docs/REQUIREMENTS.md (REQ-301).
 *
 *  - attributes other than href, src, alt, title, start, checked, align, colspan, the checkbox `type`, and a
 *    `language-…` class (vfm adds class, id, data-line, style, readOnly, tabindex)
 *  - `style="text-align:…"` on cells is read as `align`
 *  - `figure` and `figcaption` (numbered captions), `caption`, `link rel=preload`, `thead`/`tbody`, and the paragraph
 *    around an image that stands alone
 *  - `div.blockquote` is read as `blockquote`, and `s` as `del`
 *  - syntax-highlighting `span`s inside code, and, for vfm's output only (`addCodeNewline`), the newline that ends non-empty code text in the suites and not in vfm
 *  - white space: runs collapse to one space, and none is kept next to a block element
 */
import { rehype } from "rehype";

type Node = { type: string; tagName?: string; value?: string; properties?: Record<string, any>; children?: Node[] };

const BLOCK = new Set(["p", "div", "ul", "ol", "li", "blockquote", "pre", "table", "tr", "td", "th", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "section"]);
const VOID = new Set(["br", "hr", "img", "input"]);
const KEEP = new Set(["href", "src", "alt", "title", "start", "checked", "align", "colspan"]);
const UNWRAP = new Set(["figure", "thead", "tbody", "tfoot"]);
const RENAME: Record<string, string> = { s: "del", strike: "del" }; // markdown-it writes <s>; GFM and vfm write <del>
const DROP = new Set(["figcaption", "caption", "link", "style", "script"]);

const hasClass = (n: Node, c: string) => [].concat(n.properties?.className ?? []).includes(c as never);

function clean(nodes: Node[], inPre: boolean): Node[] {
  const out: Node[] = [];
  for (const n of nodes) {
    if (n.type === "comment" || n.type === "doctype") continue;
    if (n.type === "text") {
      out.push({ type: "text", value: n.value });
      continue;
    }
    if (n.type !== "element") continue;
    const tag = RENAME[n.tagName!] ?? n.tagName!;
    if (DROP.has(tag)) continue;
    const pre = inPre || tag === "pre";
    if (UNWRAP.has(tag) || (tag === "span" && inPre) || (tag === "div" && hasClass(n, "code-listing"))) {
      out.push(...clean(n.children ?? [], pre));
      continue;
    }
    const props: Record<string, any> = {};
    for (const [k, v] of Object.entries(n.properties ?? {})) {
      if (KEEP.has(k) && v !== false && v !== undefined) props[k] = v === true ? "" : String(v);
      if (k === "type" && tag === "input") props[k] = String(v);
      if (k === "className") {
        const lang = ([] as string[]).concat(v as any).find((c) => c.startsWith("language-"));
        if (lang) props.class = lang;
      }
      if (k === "style" && typeof v === "string") {
        const m = /text-align:\s*(left|right|center)/.exec(v);
        if (m) props.align = m[1];
      }
    }
    const kids = clean(n.children ?? [], pre);
    // vfm puts a picture that stands alone in a paragraph in a figure, which is unwrapped above: so is its paragraph.
    if (tag === "p" && kids.length === 1 && kids[0].tagName === "img") {
      out.push(kids[0]);
      continue;
    }
    out.push({ type: "element", tagName: tag === "div" && hasClass(n, "blockquote") ? "blockquote" : tag, properties: props, children: kids });
  }
  return out;
}

function squash(nodes: Node[], inPre: boolean): Node[] {
  // Merge neighbouring text, collapse white space outside <pre>, drop it beside block elements.
  const merged: Node[] = [];
  for (const n of nodes) {
    const last = merged[merged.length - 1];
    if (n.type === "text" && last?.type === "text") last.value += n.value;
    else merged.push(n.type === "text" ? { ...n } : { ...n, children: squash(n.children ?? [], inPre || n.tagName === "pre") });
  }
  if (inPre) return merged;
  const isBlock = (n?: Node) => !!n && n.type === "element" && BLOCK.has(n.tagName!);
  merged.forEach((n, i) => {
    if (n.type !== "text") return;
    let v = n.value!.replace(/[ \t\r\n]+/g, " ");
    if (i === 0 || isBlock(merged[i - 1])) v = v.replace(/^ /, "");
    if (i === merged.length - 1 || isBlock(merged[i + 1])) v = v.replace(/ $/, "");
    n.value = v;
  });
  return merged.filter((n) => n.type !== "text" || n.value !== "");
}

/** The suites' code text always ends with a newline and vfm's never does; a reader sees no difference. Add it to vfm's. */
function addNewline(n: Node) {
  const kids = n.children ?? [];
  const last = kids[kids.length - 1];
  if (!last) return;
  if (last.type === "text") last.value += "\n";
  else addNewline(last);
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escAttr = (s: string) => esc(s).replace(/"/g, "&quot;");

function show(n: Node): string {
  if (n.type === "text") return esc(n.value!);
  const attrs = Object.entries(n.properties ?? {})
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => ` ${k}="${escAttr(String(v))}"`)
    .join("");
  if (VOID.has(n.tagName!)) return `<${n.tagName}${attrs}>`;
  const inner = (n.children ?? []).map(show).join("");
  return `<${n.tagName}${attrs}>${inner}</${n.tagName}>`;
}

/** Canonical form of an HTML fragment; two fragments that read the same give the same string. */
export function normalizeHtml(html: string, opts: { addCodeNewline?: boolean } = {}): string {
  const tree = rehype().data("settings", { fragment: true }).parse(html) as unknown as Node;
  const body = squash(clean(tree.children ?? [], false), false);
  const walk = (n: Node) => (n.tagName === "pre" ? (opts.addCodeNewline ? addNewline(n) : undefined) : (n.children ?? []).forEach(walk));
  body.forEach(walk);
  // One block per line makes a failing diff readable.
  return body.map(show).join("\n").replace(/(<\/(?:p|ul|ol|li|blockquote|pre|table|tr|h[1-6])>)(?=<)/g, "$1\n");
}
