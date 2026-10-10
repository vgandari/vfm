/**
 * plugins/prepend-title.ts
 *
 * Remark plugin that inserts a synthetic heading node at the start of the
 * mdast tree to serve as a component title.
 *
 * The inserted heading:
 *   - Has depth = titleLevel (clamped to [1, 5])
 *   - Is marked with data.isTitle = true so remarkHeadingShift skips it
 *   - Has no label, so it does not appear in the registry as a cross-reference
 *   - Participates in section numbering via buildRegistry
 *
 * Must run before remarkHeadingShift and remarkLabels.
 *
 * Usage in pipeline.ts:
 *   import remarkPrependTitle from "./plugins/prepend-title";
 *   ...
 *   .use(remarkPrependTitle, { title: "My Title", titleLevel: 1 })
 *   .use(remarkHeadingShift, { shift })
 *   .use(remarkLabels)
 */

import type { Plugin } from "unified";
import type { Root, Heading } from "mdast";

interface PrependTitleOptions {
  title: string;
  titleLevel: number; // already clamped to [1, 5] by the caller
}

const remarkPrependTitle: Plugin<[PrependTitleOptions], Root> = function (
  options
) {
  return (tree: Root) => {
    const { title, titleLevel } = options;

    const headingNode: Heading = {
      type: "heading",
      depth: titleLevel as 1 | 2 | 3 | 4 | 5 | 6,
      children: [{ type: "text", value: title }],
      data: {
        isTitle: true, // signal to remarkHeadingShift to skip this node
      },
    };

    tree.children.unshift(headingNode);
  };
};

export default remarkPrependTitle;