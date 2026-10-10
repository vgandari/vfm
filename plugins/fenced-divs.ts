/**
 * plugins/fenced-divs.ts
 *
 * Remark plugin that parses fenced div syntax into custom AST nodes.
 *
 * Architecture: two-phase approach.
 *
 * Phase 1 (preprocessor): runs on the raw source string before remarkParse.
 *   - Scans line by line for ::: opening and closing delimiters.
 *   - Extracts each fenced div region and stores it in a map keyed by a
 *     unique placeholder ID.
 *   - Replaces each fenced div region in the source with a fenced code block:
 *       ```__fenced-div-{id}__
 *       ```
 *     Remark always preserves code blocks verbatim, so this placeholder
 *     survives the parse stage untouched.
 *
 * Phase 2 (AST transform): runs after remarkParse.
 *   - Walks tree.children looking for `code` nodes whose lang matches the
 *     placeholder pattern.
 *   - For each match, retrieves the stored fenced div data, parses the inner
 *     content with a secondary unified processor (fenced divs disabled), and
 *     replaces the code node with a `fencedDiv` AST node.
 *
 * Syntax:
 *   :::envType Optional Name {#label}
 *   Inner content (full Markdown, fenced divs disabled)
 *   :::
 *
 * Rules:
 *   - Opening line: ":::" immediately followed by a known env type or alias,
 *     then an optional name, then an optional {#label} (always last).
 *   - Closing line: a line containing exactly ":::" (optionally surrounded
 *     by whitespace), nothing else.
 *   - Lines with more or fewer colons (e.g. "::::") are not delimiters.
 *   - Fenced divs cannot be nested. The inner processor does not include
 *     this plugin, so any ":::" lines inside are rendered as plain text.
 *
 * Usage in pipeline.ts:
 *   import { preprocessFencedDivs, remarkFencedDivs, fencedDivHandler }
 *     from "./plugins/fenced-divs";
 *
 *   // 1. Preprocess source before passing to unified:
 *   const { source, store } = preprocessFencedDivs(rawSource);
 *
 *   // 2. Build processor with the store passed in:
 *   unified()
 *     .use(remarkParse)
 *     .use(remarkGfm)
 *     .use(remarkHighlight)
 *     .use(remarkFencedDivs, { store })
 *     .use(remarkRehype, { handlers: { fencedDiv: fencedDivHandler } })
 *     ...
 *     .processSync(source);
 */

import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkHighlight from "./highlight";
import type { Plugin } from "unified";
import type { Root, RootContent, Code } from "mdast";
import type { Handler } from "mdast-util-to-hast";
import type { Element, Properties } from "hast";

// ─── Known environment types ──────────────────────────────────────────────────

export const ENV_TYPES = [
  "theorem",
  "lemma",
  "corollary",
  "proposition",
  "conjecture",
  "definition",
  "example",
  "exercise",
  "hypothesis",
] as const;

export const ENV_ALIASES: Record<string, string> = {
  thm: "theorem",
  lem: "lemma",
  cor: "corollary",
  prp: "proposition",
  cnj: "conjecture",
  def: "definition",
  exm: "example",
  exr: "exercise",
  hyp: "hypothesis",
};

export type EnvType = (typeof ENV_TYPES)[number];

// ─── AST node type ────────────────────────────────────────────────────────────

export interface FencedDivNode {
  type: "fencedDiv";
  envType: EnvType;
  name: string;
  label: string | null;
  children: RootContent[];
}

declare module "mdast" {
  interface RootContentMap {
    fencedDiv: FencedDivNode;
  }
  interface BlockContentMap {
    fencedDiv: FencedDivNode;
  }
}

// ─── Printed names ────────────────────────────────────────────────────────────

export const PRINTED_NAMES: Record<EnvType, string> = {
  theorem: "Theorem",
  lemma: "Lemma",
  corollary: "Corollary",
  proposition: "Proposition",
  conjecture: "Conjecture",
  definition: "Definition",
  example: "Example",
  exercise: "Exercise",
  hypothesis: "Hypothesis",
};

// ─── Opening line parser ──────────────────────────────────────────────────────

interface ParsedOpening {
  envType: EnvType;
  name: string;
  label: string | null;
}

function parseOpeningLine(line: string): ParsedOpening | null {
  // KLUDGE: strip blockquote prefix so fenced divs inside blockquotes/alerts
  // are recognised. "> :::" is treated the same as ":::".
  const stripped = line.replace(/^(>\s*)+/, "");
  const match = stripped.match(/^:::([^:\s]+)(?:\s+(.*))?$/);
  if (!match) return null;

  const rawEnv = match[1];
  const rest = (match[2] ?? "").trim();

  const envType =
    ENV_ALIASES[rawEnv] ??
    (ENV_TYPES.includes(rawEnv as EnvType) ? rawEnv : null);
  if (!envType) return null;

  const labelMatch = rest.match(/\{#([^}]+)\}\s*$/);
  const label = labelMatch ? labelMatch[1] : null;
  const name = labelMatch ? rest.slice(0, labelMatch.index).trim() : rest;

  return { envType: envType as EnvType, name, label };
}

function isClosingLine(line: string): boolean {
  // KLUDGE: strip blockquote prefix before checking for closing ":::".
  const stripped = line.replace(/^(>\s*)+/, "");
  return /^\s*:::\s*$/.test(stripped);
}


// ─── Store ────────────────────────────────────────────────────────────────────
// Maps placeholder IDs to extracted fenced div data.

export interface FencedDivData {
  envType: EnvType;
  name: string;
  label: string | null;
  innerContent: string;
}

export type FencedDivStore = Map<string, FencedDivData>;

const PLACEHOLDER_PREFIX = "__fenced-div-";
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
  const idStr = lang.slice(PLACEHOLDER_PREFIX.length, -PLACEHOLDER_SUFFIX.length);
  const id = parseInt(idStr, 10);
  return isNaN(id) ? null : id;
}

// ─── Phase 1: Preprocessor ────────────────────────────────────────────────────

export interface PreprocessResult {
  source: string;
  store: FencedDivStore;
}

function getBlockquotePrefix(line: string): string {
  const match = line.match(/^((?:>\s*)+)/);
  return match ? match[1] : "";
}

export function preprocessFencedDivs(rawSource: string): PreprocessResult {
  const store: FencedDivStore = new Map();
  const lines = rawSource.split("\n");
  const outputLines: string[] = [];
  let id = 0;
  let i = 0;

  // Track whether we are inside a fenced code block so we never process
  // ::: delimiters that appear inside one. A code fence is ``` or ~~~
  // optionally preceded by up to 3 spaces, with optional info string after.
  // We match the opening fence and remember its character and length so we
  // can correctly identify the matching closing fence.
  let inCodeFence = false;
  let codeFenceChar = "";
  let codeFenceLen = 0;

  while (i < lines.length) {
    const line = lines[i];
    // Check for code fence open/close
    // KLUDGE: strip blockquote prefix before checking for code fences,
    // so that "> ```" inside a blockquote is recognised as a fence.
    const fenceMatch = line.replace(/^(>\s*)+/, "").match(/^( {0,3})(```+|~~~+)/);
    if (fenceMatch) {
      const fenceChar = fenceMatch[2][0];
      const fenceLen = fenceMatch[2].length;

      if (!inCodeFence) {
        // Opening fence — must be ``` or ~~~ with 3+ chars
        inCodeFence = true;
        codeFenceChar = fenceChar;
        codeFenceLen = fenceLen;
        outputLines.push(line);
        i++;
        continue;
      } else if (fenceChar === codeFenceChar && fenceLen >= codeFenceLen) {
        // Closing fence — same char, equal or longer
        inCodeFence = false;
        codeFenceChar = "";
        codeFenceLen = 0;
        outputLines.push(line);
        i++;
        continue;
      }
    }

    // Inside a code fence — pass through verbatim, no fenced div processing
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

    const prefix = getBlockquotePrefix(line);

    // Consume inner lines until a closing delimiter or end of source
    const innerLines: string[] = [];
    i++;
    while (i < lines.length && !isClosingLine(lines[i])) {
      // KLUDGE: strip blockquote prefix from inner content so it parses as
      // clean markdown regardless of whether it's inside a blockquote.
      innerLines.push(lines[i].replace(/^(>\s*)+/, ""));
      i++;
    }
    // Skip the closing ::: line if present
    if (i < lines.length) i++;

    const placeholderLang = makePlaceholderLang(id);
    store.set(placeholderLang, {
      envType: opening.envType,
      name: opening.name,
      label: opening.label,
      innerContent: innerLines.join("\n"),
    });

    // Emit a fenced code block placeholder. The blank lines around it ensure
    // remark treats it as a standalone block regardless of surrounding content.
    if (!prefix) outputLines.push("");
    outputLines.push(prefix + "```" + placeholderLang);
    outputLines.push(prefix + "```");
    if (!prefix) outputLines.push("");
    outputLines.push("");

    id++;
  }

  return { source: outputLines.join("\n"), store };
}

// ─── Inner content parser ─────────────────────────────────────────────────────
// Parses inner content as full Markdown with fenced divs disabled.
// This is the recursion guard — the inner processor includes all plugins
// except remarkFencedDivs itself.

function parseInnerContent(content: string): RootContent[] {
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkHighlight)
    .use(remarkMath);
  // remarkFencedDivs intentionally NOT included — recursion guard

  const tree = processor.parse(content);
  return (tree as Root).children;
}

// ─── Phase 2: AST transform ───────────────────────────────────────────────────

interface FencedDivsOptions {
  store: FencedDivStore;
}

export const remarkFencedDivs: Plugin<[FencedDivsOptions], Root> = function (
  options
) {
  return (tree: Root) => {
    const { store } = options;

    function processChildren(nodes: RootContent[]): RootContent[] {
      const result: RootContent[] = [];
      for (const node of nodes) {
        if (node.type === "blockquote") {
          // KLUDGE: recurse into blockquote children to find placeholders
          // emitted with ">" prefix by preprocessFencedDivs.
          (node as any).children = processChildren((node as any).children);
          result.push(node);
          continue;
        }

        if (node.type !== "code") {
          result.push(node);
          continue;
        }

        const code = node as Code;
        const id = parsePlaceholderLang(code.lang ?? "");
        if (id === null) {
          result.push(node);
          continue;
        }

        const lang = makePlaceholderLang(id);
        const data = store.get(lang);
        if (!data) {
          result.push(node);
          continue;
        }

        const children = parseInnerContent(data.innerContent);

        result.push({
          type: "fencedDiv",
          envType: data.envType,
          name: data.name,
          label: data.label,
          children,
        } as FencedDivNode);
      }
      return result;
    }

    tree.children = processChildren(tree.children);
  };
};

// ─── rehype handler ───────────────────────────────────────────────────────────

export const fencedDivHandler: Handler = (state, node: any): Element => {
  const fenced = node as FencedDivNode;
  const printedName = PRINTED_NAMES[fenced.envType] ?? fenced.envType;

  const headerChildren: Element["children"] = [
    {
      type: "element",
      tagName: "span",
      properties: { className: ["theorem-printed-name"] },
      children: [{ type: "text", value: printedName }],
    },
  ];

  if (fenced.name) {
    headerChildren.push({
      type: "element",
      tagName: "span",
      properties: { className: ["theorem-user-name"] },
      children: [{ type: "text", value: ` (${fenced.name})` }],
    });
  }

  const properties: Properties = {
    className: ["theorem-env", `theorem-${fenced.envType}`],
    "data-env-type": fenced.envType,
  };
  if (fenced.label) {
    properties["id"] = fenced.label;
    properties["data-label"] = fenced.label;
  }

  return {
    type: "element",
    tagName: "div",
    properties,
    children: [
      {
        type: "element",
        tagName: "p",
        properties: { className: ["theorem-header"] },
        children: headerChildren,
      },
      {
        type: "element",
        tagName: "div",
        properties: { className: ["theorem-body"] },
        children: state.all(node),
      },
    ],
  };
};
