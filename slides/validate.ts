/**
 * slides/validate.ts
 *
 * Stage-1 label checks, shared by both modes:
 *   unknown-label       a cross-reference names a label that exists nowhere
 *   doc-ref-into-nodoc  document content references a label defined only in a `nodoc` block
 */

import type { Root } from "mdast";
import type { NormalizedRegistry } from "../registry";
import { xrefsOf } from "./labels";
import type { Diagnostic } from "./types";
import type { Locator, SlideBlocksData } from "./directives";

/**
 * `tree` holds the content the document shows (`nodoc` blocks already removed).
 * `registry` holds every label that exists, `nodoc` ones included in slide mode.
 */
export function validateLabels(
  tree: Root,
  registry: NormalizedRegistry,
  data: Pick<SlideBlocksData, "nodocLabels">,
  locate: Locator
): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const node of tree.children) {
    const loc = locate((node as any).position?.start.line ?? 1);
    for (const label of new Set(xrefsOf(node))) {
      if (data.nodocLabels.has(label)) {
        out.push({
          code: "doc-ref-into-nodoc",
          severity: "error",
          message: `the document references "${label}", which is defined only in a nodoc block`,
          loc,
        });
      } else if (!registry.get(label)) {
        out.push({
          code: "unknown-label",
          severity: "error",
          message: `unknown label "${label}"`,
          loc,
        });
      }
    }
  }
  return out;
}
