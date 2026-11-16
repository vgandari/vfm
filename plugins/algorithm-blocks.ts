/**
 * plugins/algorithm-blocks.ts
 *
 * Remark plugin that parses ```alg blocks (pseudocode) for rendering
 * with pseudocode.js (https://github.com/SaswatPadhi/pseudocode.js).
 *
 * Architecture mirrors fenced-divs.ts: a raw-source preprocessor extracts
 * each block's body verbatim (it is LaTeX-like pseudocode, not Markdown) and
 * replaces it with a placeholder fenced code block, which survives
 * remarkParse untouched. A second pass converts the placeholder `code` node
 * into an `algorithmBlock` AST node.
 *
 * Syntax (an ordinary fenced block whose language is `alg`):
 *   ```alg Optional caption text {#alg:label}
 *   \begin{algorithm}
 *   \caption{Find Max}
 *   \begin{algorithmic}
 *   \Procedure{FindMax}{$A$}
 *     \State $m \gets A[0]$
 *     ...
 *   \EndProcedure
 *   \end{algorithmic}
 *   \end{algorithm}
 *   ```
 *
 * Rules:
 *   - Opening line: the fence, `algorithm`, then optional caption text and an
 *     optional trailing {#label} (always last).
 *   - The block closes at a fence of the same character and at least the same
 *     length (see lang-fences.ts).
 *   - The body is passed through to pseudocode.js verbatim — it is NOT
 *     parsed as Markdown.
 *   - Must run AFTER injectUuid (so {#alg:label} on the opening line becomes
 *     {#UUID-alg:label} before extraction) and AFTER remarkParse + the
 *     fenced-div preprocessor (order relative to fenced-divs doesn't matter
 *     since the placeholder lang patterns are disjoint).
 *
 * Numbering:
 *   - Registered with the registry under its own "alg" counter, producing
 *     display text like "Algorithm 1.7.2", following the same
 *     section-prefix rules as figures/tables/listings.
 *
 * Cross-references:
 *   - [@alg:label] and [@UUID-alg:label] resolve via the existing generic
 *     remarkCrossRefs plugin — no changes needed there, since the XREF
 *     pattern and registry lookup are type-agnostic.
 *
 * Usage in pipeline.ts:
 *   import {
 *     preprocessAlgorithmBlocks,
 *     remarkAlgorithmBlocks,
 *     algorithmBlockHandler,
 *   } from "./plugins/algorithm-blocks";
 *   ...
 *   const { source, store } = preprocessAlgorithmBlocks(uuidSource);
 *   ...
 *   .use(remarkAlgorithmBlocks, { store })
 *   ...
 *   .use(remarkRehype, { handlers: { algorithmBlock: algorithmBlockHandler } })
 */

import type { Plugin } from "unified";
import type { Root, RootContent, Code } from "mdast";
import type { Handler } from "mdast-util-to-hast";
import type { Element, Properties } from "hast";
import { extractLangFences } from "./lang-fences";

// ─── AST node type ────────────────────────────────────────────────────────────

export interface AlgorithmBlockNode {
  type: "algorithmBlock";
  value: string;          // raw pseudocode body, verbatim (for pseudocode.js)
  label: string | null;    // full label incl. UUID prefix, e.g. "alg:sort" or "UUID-alg:sort"
  caption: string | null;  // user-provided caption text, or null
  // populated by registry.ts during the registry pre-pass:
  displayNumber?: string;
  displayText?: string;
  suppressLabel?: boolean; // set by plugins/suppress-labels.ts
}

declare module "mdast" {
  interface RootContentMap {
    algorithmBlock: AlgorithmBlockNode;
  }
  interface BlockContentMap {
    algorithmBlock: AlgorithmBlockNode;
  }
}

// ─── Label pattern ────────────────────────────────────────────────────────────
// Matches {#alg:label} or {#UUID-alg:label} at the end of the opening line.
// The UUID prefix (if present) is a UUID v4 followed by a hyphen, injected by
// injectUuid before this plugin runs.

const UUID_PREFIX_RE =
  "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}-";
const LABEL_RE = new RegExp(
  `\\s*\\{#((?:${UUID_PREFIX_RE})?alg:[^}]+)\\}\\s*$`,
  "i"
);

// ─── Info-string parser ───────────────────────────────────────────────────────

interface ParsedOpening {
  caption: string | null;
  label: string | null;
}

/** `Caption text {#label}` after the language word of the opening fence. */
function parseInfo(info: string): ParsedOpening {
  const labelMatch = info.match(LABEL_RE);
  const label = labelMatch ? labelMatch[1].trim() : null;
  const caption = labelMatch ? info.slice(0, labelMatch.index).trim() : info.trim();
  return { caption: caption || null, label };
}

// ─── Store ────────────────────────────────────────────────────────────────────
// Maps placeholder IDs to extracted algorithm block data.

export interface AlgorithmBlockData {
  caption: string | null;
  label: string | null;
  body: string;
}

export type AlgorithmBlockStore = Map<string, AlgorithmBlockData>;

const PLACEHOLDER_PREFIX = "__algorithm-block-";
const PLACEHOLDER_SUFFIX = "__";

function makePlaceholderLang(id: number): string {
  return `${PLACEHOLDER_PREFIX}${id}${PLACEHOLDER_SUFFIX}`;
}

function parsePlaceholderLang(lang: string): number | null {
  if (
    !lang.startsWith(PLACEHOLDER_PREFIX) ||
    !lang.endsWith(PLACEHOLDER_SUFFIX)
  )
    return null;
  const idStr = lang.slice(
    PLACEHOLDER_PREFIX.length,
    -PLACEHOLDER_SUFFIX.length
  );
  const id = parseInt(idStr, 10);
  return isNaN(id) ? null : id;
}

// ─── Phase 1: Preprocessor ────────────────────────────────────────────────────

export interface PreprocessResult {
  source: string;
  store: AlgorithmBlockStore;
}

export function preprocessAlgorithmBlocks(rawSource: string): PreprocessResult {
  const store: AlgorithmBlockStore = new Map();
  const source = extractLangFences(
    rawSource,
    "alg",
    makePlaceholderLang,
    (id, { info, body }) => {
      const opening = parseInfo(info);
      store.set(makePlaceholderLang(id), { caption: opening.caption, label: opening.label, body });
    }
  );
  return { source, store };
}

// ─── Phase 2: AST transform ───────────────────────────────────────────────────

interface AlgorithmBlocksOptions {
  store: AlgorithmBlockStore;
}

export const remarkAlgorithmBlocks: Plugin<[AlgorithmBlocksOptions], Root> =
  function (options) {
    return (tree: Root) => {
      const { store } = options;

      function processChildren(nodes: RootContent[]): RootContent[] {
        const result: RootContent[] = [];
        for (const node of nodes) {
          if (node.type === "code") {
            const code = node as Code;
            const id = parsePlaceholderLang(code.lang ?? "");
            if (id !== null) {
              const lang = makePlaceholderLang(id);
              const data = store.get(lang);
              if (data) {
                result.push({
                  type: "algorithmBlock",
                  value: data.body,
                  label: data.label,
                  caption: data.caption,
                  position: node.position,
                } as AlgorithmBlockNode);
                continue;
              }
            }
          }

          if ("children" in node && Array.isArray((node as any).children)) {
            (node as any).children = processChildren((node as any).children);
          }
          result.push(node);
        }
        return result;
      }

      tree.children = processChildren(tree.children);
    };
  };

// ─── rehype handler ───────────────────────────────────────────────────────────
// Renders a caption line ("Algorithm 1.7.2: Caption text") followed by a
// <algorithm-pseudocode> element carrying the raw pseudocode body as a prop.
// Map "algorithm-pseudocode" to a client component via rehype-react's
// `components` option (see pipeline.ts / AlgorithmPseudocode.tsx).

export const algorithmBlockHandler: Handler = (_state, node: any): Element => {
  const block = node as AlgorithmBlockNode;

  const children: Element["children"] = [];

  const showNumber = !!block.displayText && !block.suppressLabel;
  if (showNumber || block.caption) {
    const captionChildren: Element["children"] = [];

    if (showNumber) {
      captionChildren.push({
        type: "element",
        tagName: "span",
        properties: { className: ["algorithm-number"] },
        children: [{ type: "text", value: block.displayText! }],
      });
      if (block.caption) {
        captionChildren.push({ type: "text", value: ": " });
      }
    }

    if (block.caption) {
      captionChildren.push({ type: "text", value: block.caption });
    }

    children.push({
      type: "element",
      tagName: "p",
      properties: { className: ["algorithm-caption"] },
      children: captionChildren,
    });
  }

  children.push({
    type: "element",
    tagName: "algorithm-pseudocode",
    properties: { code: block.value },
    children: [],
  } as unknown as Element);

  const properties: Properties = {
    className: ["algorithm-block"],
  };
  if (block.label) {
    properties["id"] = block.label;
    properties["data-label"] = block.label;
  }

  return {
    type: "element",
    tagName: "div",
    properties,
    children,
  };
};
