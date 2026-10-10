/**
 * plugins/algorithm-blocks.ts
 *
 * Remark plugin that parses "@@@" delimited pseudocode blocks for rendering
 * with pseudocode.js (https://github.com/SaswatPadhi/pseudocode.js).
 *
 * Architecture mirrors fenced-divs.ts: a raw-source preprocessor extracts
 * each block's body verbatim (it is LaTeX-like pseudocode, not Markdown) and
 * replaces it with a placeholder fenced code block, which survives
 * remarkParse untouched. A second pass converts the placeholder `code` node
 * into an `algorithmBlock` AST node.
 *
 * Syntax:
 *   @@@ Optional caption text {#alg:label}
 *   \begin{algorithm}
 *   \caption{Find Max}
 *   \begin{algorithmic}
 *   \Procedure{FindMax}{$A$}
 *     \State $m \gets A[0]$
 *     ...
 *   \EndProcedure
 *   \end{algorithmic}
 *   \end{algorithm}
 *   @@@
 *
 * Rules:
 *   - Opening line: "@@@" optionally followed by caption text and an
 *     optional trailing {#label} (always last).
 *   - Closing line: a line containing exactly "@@@" (optionally surrounded
 *     by whitespace), nothing else.
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

// ─── Opening / closing line parsers ───────────────────────────────────────────

interface ParsedOpening {
  caption: string | null;
  label: string | null;
}

function parseOpeningLine(line: string): ParsedOpening | null {
  const match = line.match(/^@@@(.*)$/);
  if (!match) return null;

  const rest = (match[1] ?? "").trim();
  const labelMatch = rest.match(LABEL_RE);
  const label = labelMatch ? labelMatch[1].trim() : null;
  const caption = labelMatch ? rest.slice(0, labelMatch.index).trim() : rest;

  return { caption: caption || null, label };
}

function isClosingLine(line: string): boolean {
  return /^\s*@@@\s*$/.test(line);
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
  const lines = rawSource.split("\n");
  const outputLines: string[] = [];
  let id = 0;
  let i = 0;

  // Track fenced code blocks so "@@@" lines inside ``` / ~~~ are ignored,
  // mirroring the same guard in fenced-divs.ts.
  let inCodeFence = false;
  let codeFenceChar = "";
  let codeFenceLen = 0;

  while (i < lines.length) {
    const line = lines[i];

    const fenceMatch = line.match(/^( {0,3})(`{3,}|~{3,})/);
    if (fenceMatch) {
      const fenceChar = fenceMatch[2][0];
      const fenceLen = fenceMatch[2].length;

      if (!inCodeFence) {
        inCodeFence = true;
        codeFenceChar = fenceChar;
        codeFenceLen = fenceLen;
        outputLines.push(line);
        i++;
        continue;
      } else if (fenceChar === codeFenceChar && fenceLen >= codeFenceLen) {
        inCodeFence = false;
        codeFenceChar = "";
        codeFenceLen = 0;
        outputLines.push(line);
        i++;
        continue;
      }
    }

    if (inCodeFence) {
      outputLines.push(line);
      i++;
      continue;
    }

    const opening = parseOpeningLine(line);
    if (!opening) {
      outputLines.push(line);
      i++;
      continue;
    }

    // Consume body lines verbatim until a closing "@@@" or end of source.
    const bodyLines: string[] = [];
    i++;
    while (i < lines.length && !isClosingLine(lines[i])) {
      bodyLines.push(lines[i]);
      i++;
    }
    if (i < lines.length) i++; // skip the closing "@@@" line

    const placeholderLang = makePlaceholderLang(id);
    store.set(placeholderLang, {
      caption: opening.caption,
      label: opening.label,
      body: bodyLines.join("\n"),
    });

    // Emit a placeholder code fence (no body) so remarkParse preserves it as
    // a `code` node we can pattern-match in phase 2.
    outputLines.push("");
    outputLines.push("```" + placeholderLang);
    outputLines.push("```");
    outputLines.push("");

    id++;
  }

  return { source: outputLines.join("\n"), store };
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
