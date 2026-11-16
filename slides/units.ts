/**
 * slides/units.ts
 *
 * Units are what the filter drops and the splitter places:
 *   - a sentence of a paragraph
 *   - a list item (its own content; nested items are units of their own)
 *   - a heading plus the first unit after it
 *   - any other whole block (an image block carries its caption)
 *
 * `materialize` turns a list of placed units back into mdast blocks, rebuilding
 * paragraphs, nested lists and repeated context along the way.
 */

import type { Heading, List, ListItem, Paragraph, Root } from "mdast";
import { labelsOf, xrefsOf } from "./labels";
import { inlineText, plainInline, segmentSentences } from "./segment";
import type { Block, ContextItem, Inline, SourceLoc } from "./types";

export type Leaf =
  /** A document separator (`---`): never shown, it starts a new slide. */
  | { kind: "break" }
  | { kind: "heading"; node: Heading }
  | { kind: "block"; node: Block }
  | { kind: "image"; node: Paragraph }
  /** A theorem environment, admonition, quote, code listing, table, algorithm or score: placed like an image. */
  | { kind: "float"; node: Block }
  | { kind: "sentence"; para: Paragraph; children: Inline[] }
  | { kind: "item"; chain: Array<{ list: List; item: ListItem }>; own: Block[]; bundle?: object };

export interface Unit {
  id: number;
  parts: Leaf[];
  /** Cross-reference labels in the unit's filterable text. */
  xrefs: string[];
  /** Labels the unit defines (a figure, table, heading, ...). */
  defines: string[];
  filterable: boolean;
  /** Presenter notes written right after this unit; they go with whichever slide it lands on. */
  notes: Inline[][];
  /** Units sharing a bundle are placed together unless they cannot fit an empty slide. */
  bundle: object;
  /** Paragraph or top-level list this unit came from, for the drop-all warning. */
  group: object;
  loc: SourceLoc;
  dropped?: string;
}

let nextId = 0;

/** Blocks that are laid out like images: at most one per slide, in the image region of rtext / ltext. */
const FLOAT_TYPES = new Set(["fencedDiv", "blockquote", "code", "table", "algorithmBlock", "musicBlock", "mermaidBlock"]);

/** Definitions are looked up document-wide and never placed on slides themselves. */
export const isDefinition = (n: { type: string }) => n.type === "footnoteDefinition" || n.type === "definition";

function isImageBlock(p: Paragraph): boolean {
  let images = 0;
  for (const c of p.children) {
    if (c.type === "image") images++;
    else if (!(c.type === "text" && !c.value.trim())) return false;
  }
  return images > 0;
}

function listLeaves(
  list: List,
  chain: Array<{ list: List; item: ListItem }>,
  out: Array<{ leaf: Leaf; root: object }>,
  root: object,
  bundles?: WeakMap<ListItem, object>
) {
  for (const item of list.children) {
    const here = [...chain, { list, item }];
    const nested = item.children.filter((c) => c.type === "list") as List[];
    const own = item.children.filter((c) => c.type !== "list") as Block[];
    // Bullets that came from one paragraph stay on one slide when they fit (see reducer.ts).
    const bundle = bundles?.get(here[0].item);
    out.push({ leaf: { kind: "item", chain: here, own, bundle }, root });
    for (const n of nested) listLeaves(n, here, out, root, bundles);
  }
}

/** HTML comments are the author's notes to themselves: never slide content. */
const isComment = (n: { type: string; value?: unknown }) => n.type === "html" && /^\s*<!--[\s\S]*-->\s*$/.test(String(n.value));

/** Text of a list item's first paragraph, to see whether it introduces a list ("…following:"). */
const endsWithColon = (item: ListItem | undefined) => {
  const first = item?.children.find((c) => c.type === "paragraph") as Paragraph | undefined;
  return !!first && /[:\uFF1A]\s*$/.test(inlineText(first.children));
};

export interface BuiltUnits {
  units: Unit[];
  strandedHeadings: Heading[];
  /** Notes written before any content in the block. */
  startNotes: Inline[][];
}

/** A `@note(...)` in a block's children. */
export const isNote = (n: { type: string }) => n.type === "vfmNote";

export function buildUnits(
  blocks: readonly Block[],
  locate: (line: number) => SourceLoc,
  /** Replaces a paragraph with slide-sized blocks (see reducer.ts); null keeps it whole. */
  reduce?: (para: Paragraph) => Block[] | null
): BuiltUnits {
  const leaves: Array<{ leaf: Leaf; group: object; source: Block }> = [];
  const pendingNotes: Array<{ afterLeaf: number; note: Inline[] }> = [];
  // Bullet lists made from consecutive paragraphs are one list, but each paragraph's bullets stay together.
  let reducedList: List | null = null;
  const bundles = new WeakMap<ListItem, object>();
  const flushList = () => {
    if (!reducedList) return;
    const out: Array<{ leaf: Leaf; root: object }> = [];
    listLeaves(reducedList, [], out, reducedList, bundles);
    for (const o of out) leaves.push({ leaf: o.leaf, group: o.root, source: reducedList! });
    reducedList = null;
  };
  /** Returns true when it also used up `next` (a list nested under a paragraph that ends with a colon). */
  const visitNode = (node: Block, fromReducer = false, next?: Block): boolean => {
    if (isDefinition(node) || isComment(node as any)) return false;
    if (fromReducer && node.type === "list" && !(node as List).ordered) {
      const bundle = {};
      for (const it of (node as List).children) bundles.set(it, bundle);
      let consumed = false;
      const last = (node as List).children[(node as List).children.length - 1];
      // "Scores are weighted as follows:" followed by a real list: that list goes under the last bullet.
      if (next?.type === "list" && !(last?.children ?? []).some((c) => c.type === "list") && endsWithColon(last)) {
        last.children.push(next as List);
        consumed = true;
      }
      if (reducedList) reducedList.children.push(...(node as List).children);
      else reducedList = { ...(node as List), children: [...(node as List).children] };
      return consumed;
    }
    flushList();
    if (isNote(node)) {
      pendingNotes.push({ afterLeaf: leaves.length - 1, note: (node as any).note });
      return false;
    }
    switch (node.type) {
      case "thematicBreak":
        leaves.push({ leaf: { kind: "break" }, group: node, source: node });
        break;
      case "heading":
        leaves.push({ leaf: { kind: "heading", node }, group: node, source: node });
        break;
      case "paragraph": {
        if (isImageBlock(node)) {
          leaves.push({ leaf: { kind: "image", node }, group: node, source: node });
          break;
        }
        const reduced = reduce?.(node);
        if (reduced) {
          let consumed = false;
          reduced.forEach((b, i) => {
            if (visitNode(b, true, i === reduced.length - 1 ? next : undefined)) consumed = true;
          });
          return consumed;
        }
        for (const children of segmentSentences(node.children as Inline[])) {
          leaves.push({ leaf: { kind: "sentence", para: node, children }, group: node, source: node });
        }
        break;
      }
      case "list": {
        const out: Array<{ leaf: Leaf; root: object }> = [];
        listLeaves(node, [], out, node);
        for (const o of out) leaves.push({ leaf: o.leaf, group: o.root, source: node });
        break;
      }
      default:
        leaves.push({
          leaf: FLOAT_TYPES.has(node.type) ? { kind: "float", node } : { kind: "block", node },
          group: node,
          source: node,
        });
    }
    return false;
  };
  for (let i = 0; i < blocks.length; i++) {
    if (visitNode(blocks[i], false, blocks[i + 1])) i++;
  }
  flushList();

  const units: Unit[] = [];
  const stranded: Heading[] = [];
  const make = (items: typeof leaves): Unit => {
    const last = items[items.length - 1];
    const leaf = last.leaf;
    let filterable = false;
    let xrefs: string[] = [];
    switch (leaf.kind) {
      case "sentence":
        filterable = true;
        xrefs = xrefsOf(leaf.children);
        break;
      case "item":
        filterable = true;
        xrefs = xrefsOf(leaf.own);
        break;
      case "block":
      case "float":
      case "image":
        // Never filtered: a reference that cannot resolve renders as plain text.
        xrefs = xrefsOf(leaf.node);
        break;
      case "heading":
        xrefs = xrefsOf(leaf.node);
        break;
    }
    const defines = labelsOf(
      items.flatMap((i) => {
        const l = i.leaf;
        if (l.kind === "sentence" || l.kind === "break") return [];
        if (l.kind === "item") return l.own;
        return [l.node];
      })
    );
    if (defines.length > 0) filterable = false;
    // A labeled heading is never dropped, and neither is its group.
    if (items.some((i) => i.leaf.kind === "heading" && (i.leaf.node.data as any)?.label)) filterable = false;
    return {
      id: nextId++,
      notes: [],
      parts: items.map((i) => i.leaf),
      xrefs,
      defines,
      filterable,
      bundle: leaf.kind === "sentence" ? leaf.para : leaf.kind === "item" && leaf.bundle ? leaf.bundle : {},
      group: last.group,
      loc: locate((last.source as any).position?.start.line ?? 1),
    };
  };

  const unitOfLeaf: number[] = leaves.map(() => -1);
  for (let i = 0; i < leaves.length; i++) {
    if (leaves[i].leaf.kind !== "heading") {
      unitOfLeaf[i] = units.length;
      units.push(make([leaves[i]]));
      continue;
    }
    const run = [leaves[i]];
    while (leaves[i + 1]?.leaf.kind === "heading") run.push(leaves[++i]);
    const next = leaves[i + 1];
    if (!next || next.leaf.kind === "break") {
      stranded.push(...run.map((r) => (r.leaf as { node: Heading }).node));
      continue;
    }
    // Headings are units of their own, never dropped with the sentence after them (that sentence may
    // reference a figure on another slide); the splitter places them together with the next unit that
    // survives, so a heading is not left at the bottom of a slide.
    for (let k = i - run.length + 1; k <= i; k++) unitOfLeaf[k] = units.length;
    units.push(make(run));
    i++;
    unitOfLeaf[i] = units.length;
    units.push(make([next]));
  }

  // A note belongs to the unit before it (a stranded heading counts as the unit before that).
  const startNotes: Inline[][] = [];
  for (const { afterLeaf, note } of pendingNotes) {
    let at = afterLeaf;
    while (at >= 0 && unitOfLeaf[at] === -1) at--;
    if (at < 0) startNotes.push(note);
    else units[unitOfLeaf[at]].notes.push(note);
  }
  return { units, strandedHeadings: stranded, startNotes };
}

// ─── Materialize ──────────────────────────────────────────────────────────────

export interface MaterializeOptions {
  /** Ancestor list levels to repeat on a continuation, nearest first kept. */
  ctxLevels: number;
  /** Heading in effect to repeat on a continuation. */
  ctxHeading?: Heading;
  /** Shallowest heading depth in the block; it becomes level 2 under the slide title. */
  minDepth: number;
  /** Image blocks go to a separate region (rtext / ltext). */
  splitImages: boolean;
}

export interface Materialized {
  body: Block[];
  images: Block[];
  context: ContextItem[];
  hasImage: boolean;
  labels: Set<string>;
}

function relativeHeading(node: Heading, minDepth: number, continued = false): Heading {
  const depth = Math.max(1, Math.min(6, node.depth - minDepth + 2)) as Heading["depth"];
  const data: any = { ...(node.data ?? {}) };
  if (continued) {
    data.hProperties = { ...(data.hProperties ?? {}), className: ["vfm-continued"] };
    delete data.hProperties.id;
  }
  return { ...node, depth, data };
}

export function materialize(units: readonly Unit[], opts: MaterializeOptions): Materialized {
  const body: Block[] = [];
  const images: Block[] = [];
  const context: ContextItem[] = [];
  const labels = new Set<string>();
  let hasImage = false;

  const paraGen = new Map<Paragraph, Paragraph>();
  const listGen = new Map<List, List>();
  const itemGen = new Map<ListItem, ListItem>();

  if (opts.ctxHeading) {
    body.push(relativeHeading(opts.ctxHeading, opts.minDepth, true));
    context.push({ kind: "heading", inline: plainInline(opts.ctxHeading.children as Inline[]), continued: true });
  }

  const genList = (list: List, item: ListItem, container: Block[] | ListItem["children"], mustBeLast: boolean): List => {
    const existing = listGen.get(list);
    if (existing && (!mustBeLast || container[container.length - 1] === existing)) return existing;
    const created: List = {
      type: "list",
      ordered: !!list.ordered,
      start: list.ordered ? (list.start ?? 1) + list.children.indexOf(item) : null,
      spread: false,
      children: [],
    };
    (container as any[]).push(created);
    listGen.set(list, created);
    return created;
  };

  for (const unit of units) {
    for (const d of unit.defines) labels.add(d);
    for (const leaf of unit.parts) {
      switch (leaf.kind) {
        case "break":
          break;
        case "heading":
          body.push(relativeHeading(leaf.node, opts.minDepth));
          break;
        case "block":
          body.push(leaf.node);
          break;
        case "image":
        case "float":
          hasImage = true;
          (opts.splitImages ? images : body).push(leaf.node);
          break;
        case "sentence": {
          const gen = paraGen.get(leaf.para);
          if (gen && body[body.length - 1] === gen) {
            gen.children.push({ type: "text", value: " " }, ...leaf.children);
          } else {
            const created: Paragraph = {
              type: "paragraph",
              children: [...leaf.children],
              data: leaf.para.data,
              position: leaf.para.position,
            };
            paraGen.set(leaf.para, created);
            body.push(created);
          }
          break;
        }
        case "item": {
          const { chain } = leaf;
          const n = chain.length - 1;
          let start = chain.findIndex((c) => !itemGen.has(c.item));
          if (start === -1) start = n;
          // Nothing of this chain is on the slide yet: repeat only the nearest ancestors.
          const fresh = start === 0;
          if (fresh) start = n - Math.min(n, opts.ctxLevels);
          let container: Block[] | ListItem["children"] = fresh ? body : itemGen.get(chain[start - 1].item)!.children;
          for (let j = start; j <= n; j++) {
            const { list, item } = chain[j];
            const gl = genList(list, item, container, j === start && fresh);
            let gi = itemGen.get(item);
            if (!gi) {
              // Keep the task checkbox and the source position (preview toggling and jump-to-source).
              gi = { type: "listItem", spread: false, checked: item.checked, position: item.position, children: [] };
              if (j < n) {
                const firstPara = item.children.find((c) => c.type === "paragraph") as Paragraph | undefined;
                const inline = plainInline((firstPara?.children ?? []) as Inline[]);
                gi.children.push({ type: "paragraph", children: inline });
                gi.data = { hProperties: { className: ["vfm-context"] } } as any;
                context.push({ kind: "listParent", inline, continued: true });
              } else {
                gi.children.push(...(leaf.own as any[]));
              }
              gl.children.push(gi);
              itemGen.set(item, gi);
            }
            container = gi.children;
          }
          break;
        }
      }
    }
  }
  return { body, images, context, hasImage, labels };
}

export function rootOf(children: Block[]): Root {
  return { type: "root", children: children as Root["children"] };
}

/** A short excerpt of a unit's text, for messages. */
export function snippet(u: Unit): string {
  const leaf = u.parts[u.parts.length - 1];
  const text =
    leaf.kind === "sentence" ? inlineText(leaf.children) : leaf.kind === "item" ? inlineText(leaf.own) : "";
  return text.length > 60 ? text.slice(0, 57) + "…" : text;
}
