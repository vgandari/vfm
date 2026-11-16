/**
 * plugins/inline-math.ts
 *
 * mdast→hast handler for `inlineMath` nodes (remark-math). remarkRehype does not know the node type and
 * would fall back to <code>, so it is rendered here with KaTeX in inline mode. Shared by the main
 * pipeline and by captions (caption-nodes.ts), which is why it has its own file.
 */

import type { Handler } from "mdast-util-to-hast";
import katex from "katex";

export const inlineMathHandler: Handler = (_state, node: any) => {
  let katexHtml: string;
  try {
    katexHtml = katex.renderToString(node.value ?? "", {
      displayMode: false,
      throwOnError: false,
      trust: true,
    });
  } catch {
    katexHtml = `<span class="katex-error">${node.value}</span>`;
  }
  return {
    type: "element",
    tagName: "span",
    properties: { className: ["math", "math-inline"] },
    children: [{ type: "raw", value: katexHtml } as any],
  };
};
