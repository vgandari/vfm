/**
 * plugins/citations.ts
 *
 * Remark plugin for `@cite(key)` / `@cite(key1, key2)` citations.
 *
 * Always records the cited keys, in order of first appearance, in
 * file.data.citeKeys (that is how collectCitations in pipeline.ts discovers
 * what to fetch). It rewrites the tree only when told how to:
 *
 *   bibliography        resolved entries: each citation becomes a link to its
 *                       reference, and a reference list is appended. How they
 *                       look is set by `config`: CitationStyle (author-year,
 *                       author, number), ReferenceStyle (APA, MLA, Vancouver)
 *                       and ReferenceSort (appearance, author, date).
 *   pending             entries are still being fetched: citations render as
 *                       "(…)" or "[…]" and no reference list is added.
 *   neither             tree untouched, `@cite(...)` stays literal text.
 *
 * Only text nodes are rewritten, so citations inside code, math and raw HTML
 * are left alone. Keys with no entry render as a red "unknown citation: key".
 *
 * Usage in pipeline.ts:
 *   .use(remarkCitations, { bibliography, pending, config, id, headingDepth })
 *   // after remarkCrossRefs, before remarkRehype
 */

import type { Plugin } from "unified";
import type {
  Root,
  Text,
  PhrasingContent,
  Heading,
  List,
  ListItem,
  Paragraph,
} from "mdast";
import { visit, SKIP } from "unist-util-visit";
import {
  CITE_RE_SOURCE,
  CitationStyle,
  splitCiteKeys,
  formatReference,
  referencesHeading,
  splitMath,
  resolveCitationConfig,
  sortReferences,
  type BibliographyMap,
  type CitationConfig,
  type FormattedReference,
} from "../bibliography";

export interface CitationsOptions {
  bibliography?: BibliographyMap;
  pending?: boolean;
  /** Reference style, citation style and sort order; see CitationConfig. */
  config?: CitationConfig;
  /** Component id; namespaces anchors so several documents can share a page. */
  id?: string | null;
  /**
   * Depth of the reference list heading (1–6) for a document with no headings.
   * Otherwise it sits beside the document's top-level sections.
   */
  headingDepth?: number;
}

function anchorId(id: string | null | undefined, key: string): string {
  return `${id ? `${id}-` : ""}ref-${key.replace(/[^\w.-]/g, "_")}`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function text(value: string): Text {
  return { type: "text", value };
}

/** Calls `fn` with the keys of every `@cite(...)` in `node`, in order, with match positions. */
function eachCitation(
  node: Text,
  fn: (keys: string[], start: number, end: number) => void
): void {
  const re = new RegExp(CITE_RE_SOURCE, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(node.value)) !== null) {
    const keys = splitCiteKeys(match[1]);
    if (keys.length > 0) fn(keys, match.index, match.index + match[0].length);
  }
}

/** Text with `$...$` turned into inlineMath nodes, which the pipeline typesets with KaTeX. */
function phrasing(value: string): PhrasingContent[] {
  return splitMath(value).map(({ math, value: part }) =>
    math ? ({ type: "inlineMath", value: part.slice(1, -1) } as unknown as PhrasingContent) : text(part)
  );
}

function referenceItem(ref: FormattedReference, id: string | null | undefined): ListItem {
  const children: PhrasingContent[] = ref.segments.flatMap((seg): PhrasingContent[] => {
    const inner = phrasing(seg.text);
    const nodes: PhrasingContent[] = seg.italic ? [{ type: "emphasis", children: inner }] : inner;
    return seg.href ? [{ type: "link", url: seg.href, title: null, children: nodes }] : nodes;
  });
  const paragraph: Paragraph = { type: "paragraph", children };
  return {
    type: "listItem",
    spread: false,
    children: [paragraph],
    data: { hProperties: { id: anchorId(id, ref.citeKey) } },
  } as ListItem;
}

const remarkCitations: Plugin<[CitationsOptions?], Root> = function (options = {}) {
  return (tree: Root, file: any) => {
    const config = resolveCitationConfig(options.config);
    const numbered = config.citationStyle === CitationStyle.Number;
    const rewrite = !!options.bibliography || !!options.pending;

    // Pass 1: which keys are cited, and in what order. Numbers and the
    // reference list order depend on the whole document, so nothing is
    // rewritten until this is done.
    const citeKeys: string[] = [];
    const seen = new Set<string>();
    visit(tree, "text", (node: Text) => {
      eachCitation(node, (keys) => {
        for (const key of keys) {
          if (!seen.has(key)) {
            seen.add(key);
            citeKeys.push(key);
          }
        }
      });
    });
    file.data.citeKeys = citeKeys;
    if (!rewrite) return;

    const formatted = new Map<string, FormattedReference>();
    for (const key of citeKeys) {
      const entry = options.bibliography?.get(key);
      if (entry) formatted.set(key, formatReference(entry, config.referenceStyle));
    }
    const ordered = sortReferences(
      citeKeys.filter((k) => formatted.has(k)).map((k) => formatted.get(k)!),
      config.sort
    );
    const numberOf = new Map(ordered.map((ref, i) => [ref.citeKey, i + 1]));

    const [open, close, separator] = numbered ? ["[", "]", ", "] : ["(", ")", "; "];

    const renderCitation = (keys: string[]): PhrasingContent[] => {
      if (!options.bibliography) return [text(`${open}…${close}`)];

      const items = keys.map((key) => ({ key, ref: formatted.get(key) }));
      // [3, 1] reads as [1, 3]; unknown keys go last.
      if (numbered) {
        items.sort((a, b) => (numberOf.get(a.key) ?? Infinity) - (numberOf.get(b.key) ?? Infinity));
      }

      const out: PhrasingContent[] = [text(open)];
      items.forEach(({ key, ref }, i) => {
        if (i > 0) out.push(text(separator));
        if (!ref) {
          out.push({
            type: "html",
            value: `<span style="color:red">unknown citation: ${escapeHtml(key)}</span>`,
          } as PhrasingContent);
          return;
        }
        const label = numbered
          ? String(numberOf.get(key))
          : config.citationStyle === CitationStyle.Author
            ? ref.author
            : ref.authorYear;
        out.push({
          type: "link",
          url: `#${anchorId(options.id, key)}`,
          title: null,
          data: { hProperties: { className: ["citation"] } },
          children: phrasing(label),
        } as PhrasingContent);
      });
      out.push(text(close));
      return out;
    };

    // Pass 2: rewrite.
    visit(tree, "text", (node: Text, index, parent: any) => {
      if (!parent || index === undefined) return;

      const replacement: PhrasingContent[] = [];
      let last = 0;
      eachCitation(node, (keys, start, end) => {
        if (start > last) replacement.push(text(node.value.slice(last, start)));
        replacement.push(...renderCitation(keys));
        last = end;
      });

      if (replacement.length === 0) return;
      if (last < node.value.length) replacement.push(text(node.value.slice(last)));
      parent.children.splice(index, 1, ...(replacement as any[]));
      return [SKIP, index + replacement.length];
    });

    if (!options.bibliography || ordered.length === 0) return;

    // Sit beside the document's sections. A lone shallowest heading is a
    // document title, so the sections are one level below it.
    const depths: number[] = [];
    visit(tree, "heading", (node: Heading) => {
      if (!(node.data as any)?.isTitle) depths.push(node.depth);
    });
    const top = Math.min(...depths);
    const depth =
      depths.length === 0
        ? options.headingDepth ?? 2
        : depths.filter((d) => d === top).length === 1 && depths.some((d) => d > top)
          ? top + 1
          : top;

    const heading: Heading = {
      type: "heading",
      depth: Math.min(6, Math.max(1, depth)) as Heading["depth"],
      children: [text(referencesHeading(config.referenceStyle))],
      data: { hProperties: { id: `${options.id ? `${options.id}-` : ""}references` } },
    };
    const list: List = {
      type: "list",
      ordered: numbered,
      spread: false,
      children: ordered.map((ref) => referenceItem(ref, options.id)),
      data: { hProperties: { className: ["references"] } },
    };
    tree.children.push(heading, list);
  };
};

export default remarkCitations;
