/**
 * plugins/music-blocks.ts
 *
 * Two-phase plugin for rendering ABC music notation using abcjs.
 *
 * Phase 1 – preprocessMusicBlocks(source):
 *   Runs on the raw source string before remark-parse.
 *   Extracts ```mus fenced blocks (ABC notation), replaces each with a
 *   placeholder code node `__music-block-N__`, and stores the original
 *   content in a Map.
 *
 * Phase 2 – remarkMusicBlocks:
 *   Converts `__music-block-N__` placeholder code nodes into `musicBlock`
 *   mdast nodes carrying the notation, label, and caption.
 *
 * Handler – musicBlockHandler:
 *   Converts a `musicBlock` node into:
 *     <div class="music-block">
 *       <p class="music-caption">Music N.M: Caption</p>
 *       <music-abc notation="..."></music-abc>
 *     </div>
 *
 * The key differences from algorithm-blocks.ts:
 *   - Custom element is "music-abc" (not "music-pseudocode" or "algorithm-pseudocode")
 *   - The body is passed as the `notation` prop (not `code`)
 *   - The node field is `notation` (not `value`) to be explicit about intent
 */

import type { Plugin } from "unified";
import type { Root, RootContent, Code } from "mdast";
import type { Handler } from "mdast-util-to-hast";
import type { Element, Properties } from "hast";
import { extractLangFences } from "./lang-fences";
import { captionNodes } from "./caption-nodes";

// ─── AST node type ────────────────────────────────────────────────────────────

export interface MusicBlockNode {
    type: "musicBlock";
    notation: string;        // raw ABC notation body, verbatim (for abcjs)
    label: string | null;
    caption: string | null;
    displayNumber?: string;
    displayText?: string;
    suppressLabel?: boolean;
}

declare module "mdast" {
    interface RootContentMap {
        musicBlock: MusicBlockNode;
    }
    interface BlockContentMap {
        musicBlock: MusicBlockNode;
    }
}

// ─── Label pattern ────────────────────────────────────────────────────────────

const UUID_PREFIX_RE =
    "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}-";
const LABEL_RE = new RegExp(
    `\\s*\\{#((?:${UUID_PREFIX_RE})?mus:[^}]+)\\}\\s*$`,
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

export interface MusicBlockData {
    caption: string | null;
    label: string | null;
    body: string;
}

export type MusicBlockStore = Map<string, MusicBlockData>;

const PLACEHOLDER_PREFIX = "__music-block-";
const PLACEHOLDER_SUFFIX = "__";

function makePlaceholderLang(id: number): string {
    return `${PLACEHOLDER_PREFIX}${id}${PLACEHOLDER_SUFFIX}`;
}

function parsePlaceholderLang(lang: string): number | null {
    if (!lang.startsWith(PLACEHOLDER_PREFIX) || !lang.endsWith(PLACEHOLDER_SUFFIX))
        return null;
    const idStr = lang.slice(PLACEHOLDER_PREFIX.length, -PLACEHOLDER_SUFFIX.length);
    const id = parseInt(idStr, 10);
    return isNaN(id) ? null : id;
}

// ─── Phase 1: Preprocessor ────────────────────────────────────────────────────

export interface PreprocessResult {
    source: string;
    store: MusicBlockStore;
}

export function preprocessMusicBlocks(rawSource: string): PreprocessResult {
  const store: MusicBlockStore = new Map();
  const source = extractLangFences(
    rawSource,
    "mus",
    makePlaceholderLang,
    (id, { info, body }) => {
      const opening = parseInfo(info);
      store.set(makePlaceholderLang(id), { caption: opening.caption, label: opening.label, body });
    }
  );
  return { source, store };
}

// ─── Phase 2: AST transform ───────────────────────────────────────────────────

interface MusicBlocksOptions {
    store: MusicBlockStore;
}

export const remarkMusicBlocks: Plugin<[MusicBlocksOptions], Root> =
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
                                    type: "musicBlock",
                                    notation: data.body,   // ← "notation", not "value"
                                    label: data.label,
                                    caption: data.caption,
                                    position: node.position,
                                } as MusicBlockNode);
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

export const musicBlockHandler: Handler = (_state, node: any): Element => {
    const block = node as MusicBlockNode;

    const children: Element["children"] = [];

    const showNumber = !!block.displayText && !block.suppressLabel;
    if (showNumber || block.caption) {
        const captionChildren: Element["children"] = [];

        if (showNumber) {
            captionChildren.push({
                type: "element",
                tagName: "span",
                properties: { className: ["music-number"] },
                children: [{ type: "text", value: block.displayText! }],
            });
            if (block.caption) {
                captionChildren.push({ type: "text", value: ": " });
            }
        }

        if (block.caption) {
            captionChildren.push(...captionNodes(block.caption));
        }

        children.push({
            type: "element",
            tagName: "p",
            properties: { className: ["music-caption"] },
            children: captionChildren,
        });
    }

    // ↓ "music-abc" not "music-pseudocode", prop is "notation" not "code"
    children.push({
        type: "element",
        tagName: "music-abc",
        properties: { notation: block.notation },
        children: [],
    } as unknown as Element);

    const properties: Properties = { className: ["music-block"] };
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
