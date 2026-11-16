/**
 * slides/split.ts
 *
 * The splitter: one greedy pass per `@slide` block, in source order.
 *
 * The renderer supplies `env.fits(slide)`, which measures a candidate with
 * everything visible: lead-in (on the last slide), new references under
 * `showrefs`, and repeated context. Units are placed one bundle at a time (a
 * paragraph's sentences stay together unless they cannot fit an empty slide).
 * Cross-reference units are dropped when their target ends up on another slide;
 * see the "Splitter" section of the spec.
 */

import type { Heading, Table } from "mdast";
import { CITE_RE_SOURCE, type BibliographyMap } from "../bibliography";
import { visit } from "unist-util-visit";
import { materialize, snippet, type Unit } from "./units";
import { inlineText } from "./segment";
import type { Block, Diagnostic, Inline, RefEntry, Slide, SlideBlock } from "./types";

/** A block ready to split: titles resolved, early drops applied. */
export interface PreparedBlock {
  block: SlideBlock;
  title: Inline[];
  titleSource: Slide["titleSource"];
  titleLine?: number;
  units: Unit[];
  minDepth: number;
  /** Notes written before any content in the block. */
  startNotes: Inline[][];
}

export interface SplitEnv {
  fits: (slide: Slide) => boolean;
  diagnostics: Diagnostic[];
  /** Label → draft it was placed on, across the whole deck. */
  placedOn: Map<string, Draft>;
  /** Reference keys already shown by closed `showrefs` slides. */
  shown: Set<string>;
  /** Formatted references for these keys, or [] when no bibliography is available. */
  refsFor: (keys: string[]) => RefEntry[];
  /** Source-ordered counter for "slide N" in messages. */
  draftCounter: { value: number };
}

export interface Draft {
  id: number;
  block: PreparedBlock;
  units: Unit[];
  ctxLevels: number;
  ctxHeading?: Heading;
  /** Presenter notes that follow this draft's content. */
  notes: Inline[][];
  closed: boolean;
  /** Whether this draft was started by an image spill. */
  spill?: boolean;
}

export function citeKeysIn(nodes: readonly any[]): string[] {
  const keys: string[] = [];
  const re = new RegExp(CITE_RE_SOURCE, "g");
  for (const n of nodes) {
    visit(n, "text", (t: any) => {
      for (const m of t.value.matchAll(re)) {
        for (const k of m[1].split(",").map((s: string) => s.trim()).filter(Boolean)) keys.push(k);
      }
    });
  }
  return keys;
}

export function splitsImages(block: SlideBlock): boolean {
  return block.options.layout === "rtext" || block.options.layout === "ltext" || block.options.layout === "2col";
}

/** Builds the slide a draft currently describes. */
export function toSlide(draft: Draft, env: Pick<SplitEnv, "refsFor" | "shown">, withLeadin: boolean): Slide {
  const { block, title, titleSource, titleLine } = draft.block;
  const place = (splitImages: boolean) =>
    materialize(draft.units, {
      ctxLevels: draft.ctxLevels,
      ctxHeading: draft.ctxHeading,
      minDepth: draft.block.minDepth,
      splitImages,
    });
  let mat = place(splitsImages(block));
  let layout: Slide["layout"] = "single";
  const opt = block.options.layout;
  const hasText = mat.body.some((b) => !(b.type === "heading" && (b.data as any)?.hProperties?.className?.includes("vfm-continued")));
  if (opt === "2col") {
    // Pictures and no text, two or more: one picture per column (REQ-172). Text with a picture, or a lone
    // picture, takes one column for the slide, with everything in source order.
    if (mat.images.length === 0) layout = "2col";
    else if (!hasText && mat.images.length > 1) layout = "2col";
    else mat = place(false);
  } else if (opt && mat.images.length > 0) layout = opt;
  // Images and floats with no text beside them take the whole slide.
  if (layout === "rtext" || layout === "ltext") {
    if (!hasText) {
      layout = "single";
      mat.body.push(...mat.images);
      mat.images = [];
    }
  }
  let references: RefEntry[] = [];
  if (block.options.showrefs) {
    const keys = [...new Set(citeKeysIn([...mat.body, ...mat.images]))].filter((k) => !env.shown.has(k));
    references = env.refsFor(keys);
  }
  return {
    kind: "slide",
    title,
    titleSource,
    titleLine,
    continuation: { index: 1, of: 1 },
    layout,
    context: mat.context,
    body: mat.body,
    images: mat.images,
    references,
    leadin: withLeadin ? block.leadin : undefined,
    leadinLine: withLeadin && block.leadin ? block.closeLine : undefined,
    steps: [[]],
    sourceBlock: block,
    labels: mat.labels,
    notes: [...draft.notes],
  };
}

/** Images and floats share the image region and the one-per-slide rules. */
function isImageUnit(u: Unit): boolean {
  return u.parts.some((p) => p.kind === "image" || p.kind === "float");
}

/** At most one theorem, admonition, quote or listing per slide. */
function isFloatUnit(u: Unit): boolean {
  return u.parts.some((p) => p.kind === "float");
}

/** A float that is a table; two of these may share a `2col` slide that has no text (REQ-241). */
function isTableUnit(u: Unit): boolean {
  return u.parts.some((p) => p.kind === "float" && p.node.type === "table");
}

export function splitBlock(prepared: PreparedBlock, env: SplitEnv): Draft[] {
  const { block } = prepared;
  const drafts: Draft[] = [];
  const pending: Array<{ unit: Unit; target: string }> = [];
  const owner = new Map<Unit, Draft>();
  const droppedItems = new Set<unknown>();
  const splitDropped: Unit[] = [];
  let lastHeading: Heading | undefined;
  let forceNew = false;
  let chunkId = -1; // ids for the pieces of a split table

  const newDraft = (ctxLevels = 0, ctxHeading?: Heading): Draft => ({
    id: env.draftCounter.value++,
    block: prepared,
    units: [],
    ctxLevels,
    ctxHeading,
    notes: [],
    closed: false,
  });

  const closeDraft = (d: Draft) => {
    if (d.closed) return;
    d.closed = true;
    if (block.options.showrefs) {
      for (const k of citeKeysIn(toSlide(d, env, false).body)) env.shown.add(k);
    }
  };

  const isDropped = (u: Unit): boolean => {
    if (u.dropped) return true;
    for (const p of u.parts) {
      if (p.kind === "item" && p.chain.some((c) => droppedItems.has(c.item))) return true;
    }
    return false;
  };

  const drop = (u: Unit, reason: string, label?: string) => {
    if (u.dropped) return;
    u.dropped = reason;
    splitDropped.push(u);
    for (const p of u.parts) if (p.kind === "item") droppedItems.add(p.chain[p.chain.length - 1].item);
    const where = owner.get(u);
    if (where) where.units = where.units.filter((x) => x !== u);
    for (let i = pending.length - 1; i >= 0; i--) if (pending[i].unit === u) pending.splice(i, 1);
    env.diagnostics.push({
      code: "drop-xref",
      severity: "info",
      message: `dropped a unit${label ? ` referencing "${label}"` : ""}: ${reason}`,
      loc: u.loc,
    });
  };

  const tryPlace = (d: Draft, units: Unit[], withLeadin: boolean): boolean => {
    if (units.some(isFloatUnit) && d.units.some(isFloatUnit)) {
      // The one exception: on a `2col` slide with no text, tables sit side by side, one per column (REQ-241).
      const tablesOnly = [...d.units, ...units].filter(isFloatUnit).every(isTableUnit);
      const noText = [...d.units, ...units].every(isImageUnit);
      if (!(block.options.layout === "2col" && tablesOnly && noText)) return false;
    }
    if (units.some(isImageUnit)) {
      const hasText = d.units.some((u) => !isImageUnit(u));
      // Image-only slides hold one image; on 2col, two (one per column).
      if (!hasText && d.units.filter(isImageUnit).length >= (block.options.layout === "2col" ? 2 : 1)) return false;
    }
    d.units.push(...units);
    if (env.fits(toSlide(d, env, withLeadin))) return true;
    d.units.length -= units.length;
    return false;
  };

  /** Starts a slide for `units`, repeating as much context as fits. */
  const startDraft = (units: Unit[], withLeadin: boolean): Draft | null => {
    const first = units[0].parts[0];
    const anc = first.kind === "item" ? first.chain.length - 1 : 0;
    const wantHeading = first.kind !== "heading" && lastHeading ? lastHeading : undefined;
    const levels = anc + (wantHeading ? 1 : 0);
    const minKeep = anc > 0 ? 1 : 0;
    for (let m = levels; m >= minKeep; m--) {
      const d = newDraft(Math.min(m, anc), m > anc ? wantHeading : undefined);
      if (tryPlace(d, units, withLeadin)) return d;
      if (m === 0) break;
    }
    return null;
  };

  const afterPlace = (d: Draft, units: Unit[]) => {
    for (const u of units) {
      owner.set(u, d);
      d.notes.push(...u.notes);
      for (const p of u.parts) if (p.kind === "heading") lastHeading = p.node;
      for (const t of new Set(u.xrefs)) {
        if (u.defines.includes(t)) continue;
        const where = env.placedOn.get(t.toLowerCase());
        if (!where) pending.push({ unit: u, target: t });
        else if (where !== d && u.filterable) {
          drop(u, `target is on an earlier slide`, t);
        }
      }
      for (const label of u.defines) {
        env.placedOn.set(label.toLowerCase(), d);
        for (let i = pending.length - 1; i >= 0; i--) {
          const p = pending[i];
          if (p.target !== label) continue;
          if (owner.get(p.unit) !== d && p.unit.filterable) drop(p.unit, "separated from its target by a slide break", label);
          else pending.splice(i, 1);
        }
      }
    }
  };

  // Bundles: consecutive units sharing a bundle are placed together.
  const live = prepared.units.filter((u) => !isDropped(u));
  const bundles: Unit[][] = [];
  for (const u of live) {
    const last = bundles[bundles.length - 1];
    if (last && last[0].bundle === u.bundle) last.push(u);
    else bundles.push([u]);
  }

  // A run of headings goes together with the next bundle, so none ends a slide on its own.
  const headingOnly = (b: Unit[]) => b.every((u) => u.parts.every((p) => p.kind === "heading"));
  for (let i = bundles.length - 2; i >= 0; i--) {
    if (headingOnly(bundles[i])) {
      bundles[i + 1] = [...bundles[i], ...bundles[i + 1]];
      bundles.splice(i, 1);
    }
  }

  const place = (units: Unit[], withLeadin: boolean): boolean => {
    let cur = drafts[drafts.length - 1];
    if (cur && !forceNew && tryPlace(cur, units, withLeadin)) {
      afterPlace(cur, units);
      return true;
    }
    // An image that overflows the image region spills onto an image-only slide right after.
    if (cur && !forceNew && splitsImages(block) && units.length === 1 && isImageUnit(units[0]) && cur.units.some(isImageUnit)) {
      const spill = newDraft();
      spill.spill = true;
      if (tryPlace(spill, units, withLeadin)) {
        closeDraft(cur);
        drafts.push(spill);
        closeDraft(spill);
        forceNew = true;
        afterPlace(spill, units);
        return true;
      }
    }
    if (cur && cur.units.length === 0 && !forceNew) return false;
    const nd = startDraft(units, withLeadin);
    if (!nd) return false;
    if (cur) closeDraft(cur);
    drafts.push(nd);
    forceNew = false;
    afterPlace(nd, units);
    return true;
  };

  if (drafts.length === 0) drafts.push(newDraft());
  drafts[0].notes.push(...prepared.startNotes);

  bundles.forEach((bundle, bi) => {
    const units = bundle.filter((u) => !isDropped(u));
    if (units.length === 0) return;
    // A document separator ends the slide; what follows starts a new one.
    if (units[0].parts[0]?.kind === "break") {
      forceNew = true;
      lastHeading = undefined; // a deliberate break is not a continuation: no repeated heading
      afterBreak(units[0]);
      return;
    }
    const withLeadin = bi === bundles.length - 1;
    if (place(units, withLeadin)) return;
    if (units.length > 1) {
      // Too large for an empty slide: its units go one by one, in order, onto as many slides as it takes.
      // Nothing is lost, so this is only a hint. A heading always travels with the unit after it.
      env.diagnostics.push({
        code: "paragraph-split",
        severity: "info",
        message: "this text was too large for one slide and continues on the next",
        loc: units.find((u) => !u.parts.every((p) => p.kind === "heading"))?.loc ?? units[0].loc,
      });
      let carry: Unit[] = [];
      units.forEach((u, i) => {
        if (isDropped(u)) return;
        if (u.parts.every((p) => p.kind === "heading") && i < units.length - 1) {
          carry.push(u);
          return;
        }
        const group = [...carry, u];
        carry = [];
        const lastOne = withLeadin && i === units.length - 1;
        if (place(group, lastOne)) return;
        // Heading plus unit does not fit together either: place them separately.
        for (const part of group) {
          if (!place([part], lastOne && part === u) && !splitTable(part, lastOne && part === u)) overflow(part);
        }
      });
      return;
    }
    if (!splitTable(units[0], withLeadin)) overflow(units[0]);
  });

  /** Notes written after a separator belong to the slide before it. */
  function afterBreak(u: Unit) {
    const cur = drafts[drafts.length - 1];
    if (cur) cur.notes.push(...u.notes);
    else prepared.startNotes.push(...u.notes);
  }

  /**
   * A table taller than an empty slide continues across slides, its header row repeated on each. A
   * table with no header row (an all-empty first row) cannot be split meaningfully and is left off.
   * Returns false when `u` is not a splittable table.
   */
  function splitTable(u: Unit, withLeadin: boolean): boolean {
    const table = u.parts.length === 1 && u.parts[0].kind === "float" && (u.parts[0].node.type === "table" ? (u.parts[0].node as Table) : undefined);
    if (!table || table.children.length < 3) return false;
    const [header, ...body] = table.children;
    if (!header.children.some((c) => inlineText(c.children as any[]).trim() !== "")) return false;

    const chunk = (rows: Table["children"], first: boolean): Unit => {
      const data: any = { ...(table.data ?? {}) };
      // Only the first piece is the target of a label and of the cross-references in its caption.
      if (!first) {
        delete data.label;
        delete data.displayNumber;
        delete data.displayText;
      }
      return {
        ...u,
        id: chunkId--,
        parts: [{ kind: "float", node: { ...table, data, children: [header, ...rows] } as Table }],
        xrefs: first ? u.xrefs : [],
        defines: first ? u.defines : [],
        notes: [],
        filterable: false,
      };
    };
    // Does header + these rows fit an empty slide? (Same measurement as everything else.) The last piece
    // carries the block's lead-in, so it is measured with it: a piece that fits only without the lead-in
    // would be refused when placed, and the table would be lost (REQ-231).
    const alone = (rows: Table["children"], last: boolean) => {
      const draft: Draft = { id: -1, block: prepared, units: [chunk(rows, true)], ctxLevels: 0, notes: [], closed: false };
      return env.fits(toSlide(draft, env, withLeadin && last));
    };
    let from = 0;
    const pieces: Unit[] = [];
    while (from < body.length) {
      let lo = 0;
      let hi = body.length - from;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (alone(body.slice(from, from + mid), from + mid === body.length)) lo = mid;
        else hi = mid - 1;
      }
      if (lo === 0) return false; // not even one row fits: leave the table off
      pieces.push(chunk(body.slice(from, from + lo), pieces.length === 0));
      from += lo;
    }
    pieces[pieces.length - 1].notes = u.notes;
    env.diagnostics.push({
      code: "table-split",
      severity: "info",
      message: `a table was too large for one slide and continues across ${pieces.length} slides, its header repeated`,
      loc: u.loc,
    });
    pieces.forEach((piece, i) => {
      if (!place([piece], withLeadin && i === pieces.length - 1)) overflow(piece);
    });
    return true;
  }

  /**
   * A unit that cannot fit even an empty slide (a float is first scaled down to half size). Images, floats
   * (theorem environments, code listings, algorithms, scores, diagrams, tables with no header row) are
   * simply left off the slide, with a hint; there is nothing smaller to put there. Anything else, such as
   * one sentence taller than a slide, is an error the author has to fix.
   */
  function overflow(u: Unit) {
    const leftOff = u.parts.some((p) => p.kind === "float" || p.kind === "image");
    env.diagnostics.push(
      leftOff
        ? { code: "drop-float", severity: "info", message: "left off the slides: it does not fit on a slide", loc: u.loc }
        : { code: "overflow", severity: "error", message: "this content cannot fit on an empty slide", loc: u.loc }
    );
    u.dropped = "overflow";
    afterBreak(u); // its notes stay with the slide before it
  }

  for (const p of pending.splice(0)) {
    if (p.unit.filterable) drop(p.unit, "target is not on this slide", p.target);
  }

  // What follows a drop may begin with "This" or "It".
  for (const u of splitDropped) {
    const next = prepared.units.slice(prepared.units.indexOf(u) + 1).find((x) => !isDropped(x));
    if (next) {
      env.diagnostics.push({
        code: "drop-follows",
        severity: "info",
        message: `kept text follows a dropped unit and may read oddly: "${snippet(next)}"`,
        loc: next.loc,
      });
    }
  }
  drafts.forEach(closeDraft);
  // A slide whose content was all dropped still has notes the author wrote: pass them to a neighbour.
  const kept = drafts.filter((d) => d.units.length > 0);
  for (const d of drafts) {
    if (d.units.length > 0 || d.notes.length === 0 || kept.length === 0) continue;
    const before = [...kept].reverse().find((k) => drafts.indexOf(k) < drafts.indexOf(d));
    if (before) before.notes.push(...d.notes);
    else kept[0].notes.unshift(...d.notes);
  }
  return kept;
}

export type { BibliographyMap, Block };
