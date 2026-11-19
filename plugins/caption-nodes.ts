/**
 * plugins/caption-nodes.ts
 *
 * Turns the source text of a caption into hast nodes, so a caption can hold inline Markdown: `$math$`,
 * sub/superscripts (`H_{2}O`), emphasis, code, underline. Used for figures, tables, listings, algorithms,
 * scores and diagrams, in document and slide mode (REQ-121).
 *
 * A caption is one line of inline text. If it parses as anything else (a list, a heading) or fails, it is
 * shown as plain text. A `$` that does not close stays a dollar sign, as in a paragraph.
 */

import type { Element, ElementContent, Root as HastRoot } from "hast";
import type { Root } from "mdast";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkRehype from "remark-rehype";
import remarkUnderline from "./underline";
import remarkSubSup from "./sub-sup";
import remarkNoHtml from "./no-html";
import remarkHighlight, { highlightHandler } from "./highlight";
import { inlineMathHandler } from "./inline-math";

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm, { singleTilde: false })
  .use(remarkUnderline)
  .use(remarkSubSup)
  .use(remarkNoHtml)
  .use(remarkMath)
  .use(remarkHighlight)
  .use(remarkRehype, { handlers: { inlineMath: inlineMathHandler, highlight: highlightHandler } });

/** Changes the caption's parsed tree before it becomes hast; the citation plugin passes one that turns `@cite(...)` into links. */
export type CaptionRewrite = (tree: Root) => void;

export function captionNodes(source: string, rewrite?: CaptionRewrite): ElementContent[] {
  try {
    const tree = processor.parse(source) as Root;
    rewrite?.(tree);
    const hast = processor.runSync(tree) as HastRoot;
    const first = hast.children[0];
    if (hast.children.length === 1 && first.type === "element" && (first as Element).tagName === "p") {
      return (first as Element).children;
    }
  } catch {
    /* fall through to plain text */
  }
  return [{ type: "text", value: source }];
}
