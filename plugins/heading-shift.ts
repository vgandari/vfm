/**
 * plugins/heading-shift.ts
 *
 * Remark plugin that shifts all heading depths down by a fixed amount.
 * Headings that would exceed h6 are converted to a custom `shiftedHeading`
 * node which the heading handler renders as <p><strong>Title</strong></p>.
 *
 * - Section numbering in the registry ignores shifted-beyond-h6 headings.
 * - If the heading had a {#sec:label}, it still gets an id on the rendered
 *   element so cross-references can scroll to it.
 * - Does NOT run inside fenced div inner content.
 *
 * Usage in pipeline.ts:
 *   import remarkHeadingShift from "./plugins/heading-shift";
 *   ...
 *   .use(remarkHeadingShift, { shift: headingShift })
 *   // after remarkFencedDivs, before remarkLabels
 */

import type { Plugin } from "unified";
import type { Root, RootContent } from "mdast";
import { visit } from "unist-util-visit";

export interface ShiftedHeadingNode {
  type: "shiftedHeading";
  children: RootContent[];
  data?: {
    label?: string | null;
    hProperties?: { id?: string };
  };
}

declare module "mdast" {
  interface RootContentMap {
    shiftedHeading: ShiftedHeadingNode;
  }
}

interface HeadingShiftOptions {
  shift: number; // 0–5
}

const remarkHeadingShift: Plugin<[HeadingShiftOptions], Root> = function (
  options
) {
  return (tree: Root) => {
    const { shift } = options;
    if (!shift) return;

    visit(tree, "heading", (node: any, index, parent: any) => {
      if (!parent || index === undefined) return;
      // Skip the synthetic title heading inserted by remarkPrependTitle
      if (node.data?.isTitle) return;
      const newDepth = node.depth + shift;
      if (newDepth <= 6) {
        node.depth = newDepth;
      } else {
        const shiftedNode: ShiftedHeadingNode = {
          type: "shiftedHeading",
          children: node.children,
          data: node.data,
        };
        parent.children.splice(index, 1, shiftedNode);
      }
    });
  };
};

export default remarkHeadingShift;
