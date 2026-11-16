/**
 * plugins/mermaid-blocks.ts
 *
 * Two-phase plugin for Mermaid diagrams, written as fenced code:
 *
 *   ```mermaid Optional caption text {#fig:label}
 *   graph TD; A-->B
 *   ```
 *
 * Same architecture as music-blocks.ts: a raw-source pass swaps each block for a
 * placeholder fence (same line count), a remark pass turns the placeholder into a
 * `mermaidBlock` node, and the handler emits <mermaid-diagram source="...">, which
 * pipeline.ts maps to the MermaidDiagram component.
 *
 * A diagram is a figure: its label is `fig:` and it takes the next "Figure N" number.
 */

import type { Plugin } from "unified";
import type { Root, RootContent, Code } from "mdast";
import type { Handler } from "mdast-util-to-hast";
import type { Element, Properties } from "hast";
import { extractLangFences } from "./lang-fences";

export interface MermaidBlockNode {
  type: "mermaidBlock";
  source: string;
  label: string | null;
  caption: string | null;
  displayNumber?: string;
  displayText?: string;
  suppressLabel?: boolean;
}

declare module "mdast" {
  interface RootContentMap {
    mermaidBlock: MermaidBlockNode;
  }
  interface BlockContentMap {
    mermaidBlock: MermaidBlockNode;
  }
}

const UUID_PREFIX_RE = "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}-";
const LABEL_RE = new RegExp(`\\s*\\{#((?:${UUID_PREFIX_RE})?fig:[^}]+)\\}\\s*$`, "i");

export interface MermaidBlockData {
  caption: string | null;
  label: string | null;
  body: string;
}

export type MermaidBlockStore = Map<string, MermaidBlockData>;

const PREFIX = "__mermaid-block-";
const SUFFIX = "__";
const makePlaceholderLang = (id: number) => `${PREFIX}${id}${SUFFIX}`;

function parsePlaceholderLang(lang: string): number | null {
  if (!lang.startsWith(PREFIX) || !lang.endsWith(SUFFIX)) return null;
  const id = parseInt(lang.slice(PREFIX.length, -SUFFIX.length), 10);
  return isNaN(id) ? null : id;
}

export function preprocessMermaidBlocks(rawSource: string): { source: string; store: MermaidBlockStore } {
  const store: MermaidBlockStore = new Map();
  const source = extractLangFences(rawSource, "mermaid", makePlaceholderLang, (id, { info, body }) => {
    const labelMatch = info.match(LABEL_RE);
    const caption = (labelMatch ? info.slice(0, labelMatch.index) : info).trim();
    store.set(makePlaceholderLang(id), {
      caption: caption || null,
      label: labelMatch ? labelMatch[1].trim() : null,
      body,
    });
  });
  return { source, store };
}

export const remarkMermaidBlocks: Plugin<[{ store: MermaidBlockStore }], Root> = function (options) {
  return (tree: Root) => {
    const visitChildren = (nodes: RootContent[]): RootContent[] => {
      const result: RootContent[] = [];
      for (const node of nodes) {
        if (node.type === "code") {
          const id = parsePlaceholderLang((node as Code).lang ?? "");
          const data = id === null ? undefined : options.store.get(makePlaceholderLang(id));
          if (data) {
            result.push({
              type: "mermaidBlock",
              source: data.body,
              label: data.label,
              caption: data.caption,
              position: node.position,
            } as MermaidBlockNode as unknown as RootContent);
            continue;
          }
        }
        if ("children" in node && Array.isArray((node as any).children)) {
          (node as any).children = visitChildren((node as any).children);
        }
        result.push(node);
      }
      return result;
    };
    tree.children = visitChildren(tree.children);
  };
};

export const mermaidBlockHandler: Handler = (_state, node: any): Element => {
  const block = node as MermaidBlockNode;
  const children: Element["children"] = [];

  const showNumber = !!block.displayText && !block.suppressLabel;
  if (showNumber || block.caption) {
    const caption: Element["children"] = [];
    if (showNumber) {
      caption.push({
        type: "element",
        tagName: "span",
        properties: { className: ["mermaid-number"] },
        children: [{ type: "text", value: block.displayText! }],
      });
      if (block.caption) caption.push({ type: "text", value: ": " });
    }
    if (block.caption) caption.push({ type: "text", value: block.caption });
    children.push({ type: "element", tagName: "p", properties: { className: ["mermaid-caption"] }, children: caption });
  }

  children.push({
    type: "element",
    tagName: "mermaid-diagram",
    properties: { source: block.source },
    children: [],
  } as unknown as Element);

  const properties: Properties = { className: ["mermaid-block"] };
  if (block.label) {
    properties["id"] = block.label;
    properties["data-label"] = block.label;
  }
  return { type: "element", tagName: "div", properties, children };
};
