/**
 * plugins/suppress-labels.ts
 *
 * Remark plugin that sets `data.suppressLabel = true` on labeled elements
 * whose display label should be hidden because the element has neither a
 * caption nor any cross-references pointing to it.
 *
 * Applies to: figures (images), tables, code listings, algorithm blocks,
 * music blocks, fenced divs (theorem environments). Equations are explicitly
 * excluded — their existing numbering behaviour is unchanged regardless of
 * this option.
 *
 * Must run after remarkCrossRefs, which populates file.data.referencedLabels
 * with the set of label ids that were actually linked in the document.
 *
 * Logic per element:
 *   suppress = !hasCaption && !isReferenced
 *
 * Usage in pipeline.ts:
 *   import remarkSuppressLabels from "./plugins/suppress-labels";
 *   ...
 *   .use(remarkCrossRefs, { registry, id: options.id })
 *   .use(remarkSuppressLabels)   // immediately after remarkCrossRefs
 */

import type { Plugin } from "unified";
import type { Root, RootContent, Image, Table, Code } from "mdast";
import type { FencedDivNode } from "./fenced-divs";
import type { AlgorithmBlockNode } from "./algorithm-blocks";
import type { MusicBlockNode } from "./music-blocks";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hasCaption(data: any): boolean {
  return typeof data?.caption === "string" && data.caption.trim().length > 0;
}

function isReferenced(data: any, referencedLabels: Set<string>): boolean {
  return typeof data?.label === "string" && referencedLabels.has(data.label);
}

function shouldSuppress(data: any, referencedLabels: Set<string>): boolean {
  return !hasCaption(data) && !isReferenced(data, referencedLabels);
}

// ─── Tree walker ──────────────────────────────────────────────────────────────

function walk(nodes: RootContent[], referencedLabels: Set<string>): void {
  for (const node of nodes) {
    switch (node.type) {
      case "paragraph": {
        const para = node as any;
        const img = para.children?.find(
          (c: any) => c.type === "image" && c.data?.labelType === "fig"
        ) as Image | undefined;
        if (img) {
          const data = img.data as any;
          if (shouldSuppress(data, referencedLabels)) {
            data.suppressLabel = true;
          }
        }
        break;
      }

      case "table": {
        const data = (node as Table).data as any;
        if (data?.labelType === "tab" && shouldSuppress(data, referencedLabels)) {
          data.suppressLabel = true;
        }
        break;
      }

      case "code": {
        const data = (node as Code).data as any;
        if (data?.labelType === "lst" && shouldSuppress(data, referencedLabels)) {
          data.suppressLabel = true;
        }
        break;
      }

      case "algorithmBlock": {
        const block = node as unknown as AlgorithmBlockNode;
        if (shouldSuppress(block, referencedLabels)) {
          block.suppressLabel = true;
        }
        break;
      }

      case "musicBlock": {                                    // ← ADDED
        const block = node as unknown as MusicBlockNode;
        if (shouldSuppress(block, referencedLabels)) {
          block.suppressLabel = true;
        }
        break;
      }

      case "fencedDiv": {
        const fenced = node as unknown as FencedDivNode;
        const data = fenced as any;
        const captioned = typeof fenced.name === "string" && fenced.name.trim().length > 0;
        const referenced =
          typeof fenced.label === "string" && referencedLabels.has(fenced.label);
        if (!captioned && !referenced) {
          data.suppressLabel = true;
        }
        walk(fenced.children, referencedLabels);
        break;
      }

      default: {
        if ("children" in node && Array.isArray((node as any).children)) {
          walk((node as any).children, referencedLabels);
        }
        break;
      }
    }
  }
}

// ─── Remark plugin ────────────────────────────────────────────────────────────

const remarkSuppressLabels: Plugin<[], Root> = function () {
  return (tree: Root, file: any) => {
    const referencedLabels: Set<string> =
      (file.data?.referencedLabels as Set<string> | undefined) ?? new Set();
    walk(tree.children, referencedLabels);
  };
};

export default remarkSuppressLabels;
