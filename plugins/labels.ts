/**
 * plugins/labels.ts
 *
 * Remark plugin that strips {#type:label} syntax and captions from headings,
 * figures, tables, and code blocks, attaching them as `data` on each AST node.
 *
 * Handled elements:
 *
 *   Headings:
 *     ## Section Title {#sec:label}
 *     → strips {#sec:label} from heading text children
 *     → attaches { hProperties: { id }, label, labelType: "sec" } to node.data
 *
 *   Figures (images):
 *     ![Caption text](url) {#fig:label}
 *     → {#fig:label} appears as a trailing text node in the paragraph wrapping
 *       the image, or as part of the alt text.
 *     → attaches { label, labelType: "fig", caption } to the image node.data
 *     → strips the {#fig:label} token from the surrounding paragraph text
 *
 *   Tables:
 *     Caption text. {#tab:label}
 *     | col | col |
 *     → the paragraph immediately before the table contains the caption and
 *       optional label.
 *     → attaches { label, labelType: "tab", caption } to the table node.data
 *     → removes the caption paragraph from the tree
 *
 *   Code blocks:
 *     ```python Caption text {#lst:label}
 *     → label and caption are in the info string (after the language token)
 *     → attaches { label, labelType: "lst", caption, lang } to node.data
 *     → strips label and caption from node.meta
 *
 * Usage in pipeline.ts:
 *   import remarkLabels from "./plugins/labels";
 *   ...
 *   .use(remarkLabels)   // after remarkFencedDivs, before remarkRehype
 */

import type { Plugin } from "unified";
import type {
  Root,
  RootContent,
  Heading,
  Image,
  Table,
  Code,
  Paragraph,
  Text,
  PhrasingContent,
} from "mdast";
import { visit } from "unist-util-visit";

// ─── Shared label data attached to nodes ─────────────────────────────────────

export interface LabelData {
  label: string | null;
  labelType: string | null;
  caption: string | null;
}

// Extend mdast node data types
declare module "mdast" {
  interface HeadingData {
    label?: string | null;
    labelType?: string | null;
    hProperties?: { id?: string;[key: string]: unknown };
  }
  interface ImageData {
    label?: string | null;
    labelType?: string | null;
    caption?: string | null;
  }
  interface TableData {
    label?: string | null;
    labelType?: string | null;
    caption?: string | null;
  }
  interface CodeData {
    label?: string | null;
    labelType?: string | null;
    caption?: string | null;
  }
}

// ─── Label pattern ────────────────────────────────────────────────────────────
// Matches {#type:label} or {#UUID-type:label} at the end of a string.
// The UUID prefix (if present) is a UUID v4 followed by a hyphen.

const UUID_PREFIX_RE = "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}-";
const LABEL_RE = new RegExp(
  `\\s*\\{#(?:${UUID_PREFIX_RE})?([a-z]+):([^}]+)\\}\\s*$`,
  "i"
);

// Full label including UUID prefix, for registration in the registry
const FULL_LABEL_RE = new RegExp(
  `\\s*\\{#((?:${UUID_PREFIX_RE})?[a-z]+:[^}]+)\\}\\s*$`,
  "i"
);

interface ParsedLabel {
  labelType: string;
  label: string;
  textBefore: string;
}

function extractLabel(text: string): ParsedLabel | null {
  const match = text.match(FULL_LABEL_RE);
  if (!match) return null;
  // match[1] is the full label including UUID prefix e.g. "UUID-fig:diagram"
  const fullLabel = match[1].trim();
  // Extract just the type (last segment before the colon after any UUID prefix)
  const colonIdx = fullLabel.indexOf(":");
  const typeAndPrefix = fullLabel.slice(0, colonIdx); // e.g. "UUID-fig" or "fig"
  const hyphenIdx = typeAndPrefix.lastIndexOf("-");
  const labelType = hyphenIdx !== -1
    ? typeAndPrefix.slice(hyphenIdx + 1)  // e.g. "fig"
    : typeAndPrefix;
  return {
    labelType,
    label: fullLabel,
    textBefore: text.slice(0, match.index).trimEnd(),
  };
}

// ─── Heading handler ──────────────────────────────────────────────────────────

function processHeading(node: Heading): void {
  if (node.children.length === 0) return;

  const last = node.children[node.children.length - 1];
  if (last.type !== "text") return;

  const parsed = extractLabel(last.value);
  if (!parsed) return;

  last.value = parsed.textBefore;
  if (!last.value) node.children.pop();

  node.data = node.data ?? {};
  node.data.label = parsed.label;
  node.data.labelType = parsed.labelType;
  node.data.hProperties = {
    ...node.data.hProperties,
    id: parsed.label,
  };
}

// ─── Figure handler ───────────────────────────────────────────────────────────

function processFigureParagraph(para: Paragraph): void {
  const imgIdx = para.children.findIndex((c) => c.type === "image");
  if (imgIdx === -1) return;

  const img = para.children[imgIdx] as Image;

  // Case 1: label is in a trailing text node after the image
  const after = para.children.slice(imgIdx + 1);
  if (after.length > 0) {
    const last = after[after.length - 1];
    if (last.type === "text") {
      const parsed = extractLabel((last as Text).value);
      if (parsed) {
        (last as Text).value = parsed.textBefore;
        if (!(last as Text).value.trim()) {
          para.children.splice(imgIdx + 1 + after.length - 1, 1);
        }
        img.data = img.data ?? {};
        img.data.label = parsed.label;
        img.data.labelType = parsed.labelType;
        img.data.caption = img.alt || null;
        return;
      }
    }
  }

  // Case 2: label is embedded in the alt text
  if (img.alt) {
    const parsed = extractLabel(img.alt);
    if (parsed) {
      img.alt = parsed.textBefore;
      img.data = img.data ?? {};
      img.data.label = parsed.label;
      img.data.labelType = parsed.labelType;
      img.data.caption = img.alt || null;
      return;
    }
  }

  // No label — still mark for numbering
  img.data = img.data ?? {};
  img.data.label = null;
  img.data.labelType = "fig";
  img.data.caption = img.alt || null;
}

// ─── Table handler ────────────────────────────────────────────────────────────

function extractTextContent(nodes: PhrasingContent[]): string {
  return nodes
    .map((n) => {
      if (n.type === "text") return (n as Text).value;
      if ("children" in n && Array.isArray((n as any).children)) {
        return extractTextContent((n as any).children);
      }
      return "";
    })
    .join("");
}

function processTables(nodes: any[]): void {
  let i = 0;
  while (i < nodes.length) {
    const node = nodes[i];

    if (node.type === "blockquote") {
      processTables(node.children);
      i++;
      continue;
    }

    if (node.type !== "table") {
      i++;
      continue;
    }

    const table = node as Table;
    table.data = table.data ?? {};
    table.data.labelType = "tab";

    if (
      i > 0 &&
      nodes[i - 1].type === "paragraph" &&
      nodes[i - 1].position?.end.line === node.position?.start.line - 1
    ) {
      const captionPara = nodes[i - 1] as Paragraph;
      const rawCaption = extractTextContent(captionPara.children);
      const parsed = extractLabel(rawCaption);

      if (parsed) {
        table.data.label = parsed.label;
        table.data.labelType = parsed.labelType;
        table.data.caption = parsed.textBefore || null;
      } else {
        table.data.label = null;
        table.data.caption = rawCaption || null;
      }

      // Remove the caption paragraph in place
      nodes.splice(i - 1, 1);
      // i now points to the table since we removed the preceding node
      i++;
    } else {
      table.data.label = null;
      table.data.caption = null;
      i++;
    }
  }
}

// ─── Code block handler ───────────────────────────────────────────────────────

function processCodeBlock(node: Code): void {
  // Skip fenced div placeholder nodes injected by the preprocessor
  if (node.lang && node.lang.startsWith("__fenced-div-")) return;

  node.data = node.data ?? {};
  node.data.labelType = "lst";

  const meta = node.meta ?? "";
  if (!meta.trim()) {
    node.data.label = null;
    node.data.caption = null;
    return;
  }

  const parsed = extractLabel(meta);
  if (parsed) {
    node.data.label = parsed.label;
    node.data.caption = parsed.textBefore || null;
    node.meta = parsed.textBefore || null;
  } else {
    node.data.label = null;
    node.data.caption = meta.trim();
  }
}

// ─── Remark plugin ────────────────────────────────────────────────────────────

const remarkLabels: Plugin<[], Root> = function () {
  return (tree: Root) => {
    // Tables require looking at siblings so are handled separately
    processTables(tree.children as any[]);

    visit(tree, (node) => {
      switch (node.type) {
        case "heading":
          processHeading(node as Heading);
          break;
        case "paragraph":
          processFigureParagraph(node as Paragraph);
          break;
        case "code":
          processCodeBlock(node as Code);
          break;
      }
    });
  };
};

export default remarkLabels;
