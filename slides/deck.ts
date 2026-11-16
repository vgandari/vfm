/**
 * slides/deck.ts
 *
 * Builds the slide view of a document: stages 1–7 of the spec's pipeline.
 *
 *   1  parse and validate          (parseForSlides + validateLabels)
 *   2  resolve titles
 *   3  prune to @slide content
 *   4  merge dividers and agendas
 *   5  filter and split            (split.ts, with the renderer's fit measurer)
 *   6  number figures, citations and references deck-wide
 *   7  assign reveal steps
 */

import type { Heading, List, ListItem, Root } from "mdast";
import { parseForSlides } from "../pipeline";
import { parseFrontmatter, type Affiliation } from "../frontmatter";
import { buildRegistry, NormalizedRegistry } from "../registry";
import {
  formatReference,
  resolveCitationConfig,
  sortReferences,
  type BibliographyMap,
  type CitationConfig,
} from "../bibliography";
import { visit } from "unist-util-visit";
import { validateLabels } from "./validate";
import { labelsOf, xrefsOf } from "./labels";
import { estimateFits, type Measurer } from "./measure";
import { inlineText, plainInline } from "./segment";
import { renderSlide, type SlideRenderContext } from "./render";
import { citeKeysIn, splitBlock, toSlide, type Draft, type PreparedBlock, type SplitEnv } from "./split";
import { buildDocStats, PARAGRAPH_MODES, reduceParagraph, type ParagraphsMode } from "./reducer";
import { buildUnits, isDefinition, isNote, rootOf, snippet, type Unit } from "./units";
import { SlideDirectiveError } from "./types";
import { parseThemeColor } from "./themeColor";
import type {
  Block,
  Diagnostic,
  Inline,
  RefEntry,
  Slide,
  SlideBlock,
  SourceLoc,
} from "./types";

export interface SlideDeckOptions {
  /** Where each line of the content came from (see expandIncludes). */
  sourceMap?: SourceLoc[];
  /** Answers "does this slide fit?". Defaults to a character-count estimate. */
  measure?: Measurer;
  /** `check` warns when a content slide holds more headings than this. Default 2. */
  maxHeadings?: number;
  bibliography?: BibliographyMap;
  citations?: CitationConfig;
  /** How paragraphs become slide text. Overrides the front matter's `paragraphs:`; default "auto". */
  paragraphs?: ParagraphsMode;
  /** Rewrites image URLs (for example to webview URIs) before measuring and rendering. */
  resolveUrl?: (url: string) => string;
}

export interface SlideDeck {
  slides: Slide[];
  diagnostics: Diagnostic[];
  /** Deck-wide numbering of figures, tables, listings, equations. */
  registry: NormalizedRegistry;
  render: SlideRenderContext;
  /** Every image URL used, for preloading. */
  imageUrls: string[];
}

const EMPTY_DECK = (diagnostics: Diagnostic[]): SlideDeck => ({
  slides: [],
  diagnostics,
  registry: new NormalizedRegistry(),
  render: { registry: new NormalizedRegistry(), citeKeys: [], numberOf: new Map(), definitions: [] },
  imageUrls: [],
});

type Entry =
  | { kind: "content"; block: SlideBlock }
  | { kind: "agenda"; block: SlideBlock }
  | { kind: "divider"; blocks: SlideBlock[] };

const isHeading = (n: Block): n is Heading => n.type === "heading";
/** A block's own content: link and footnote definitions are looked up document-wide, not placed. */
const contentOf = (b: SlideBlock) => b.children.filter((n) => !isDefinition(n) && !isNote(n));
const notesOf = (b: SlideBlock): Inline[][] => b.children.filter(isNote).map((n) => (n as any).note as Inline[]);
const isDividerBlock = (b: SlideBlock) => contentOf(b).every(isHeading);

/** A position that points at one line; for generated nodes that stand for a directive line. */
const atLine = (line?: number) => (line ? { start: { line, column: 1 }, end: { line, column: 1 } } : undefined);

function resolveTitle(b: SlideBlock): Pick<PreparedBlock, "title" | "titleSource" | "titleLine"> {
  if (b.title !== undefined) return { title: b.title, titleSource: "override", titleLine: b.openLine };
  if (b.headingInEffect) return { title: plainInline(b.headingInEffect.inline), titleSource: "heading", titleLine: b.headingInEffect.line };
  return { title: [], titleSource: "none" };
}

export function buildSlideDeck(content: string, options: SlideDeckOptions = {}): SlideDeck {
  const diagnostics: Diagnostic[] = [];
  const { tree, data, locate } = parseForSlides(content, {
    numberingDepth: 0,
    headingShift: 0,
    id: null,
    sourceMap: options.sourceMap,
  });
  diagnostics.push(...data.diagnostics);
  const { blocks } = data;
  if (diagnostics.some((d) => d.severity === "error")) throw new SlideDirectiveError(diagnostics);
  if (blocks.length === 0) return EMPTY_DECK(diagnostics);

  // ── Stage 1: validate ──────────────────────────────────────────────────────
  const fullRegistry = buildRegistry(tree, { numberingDepth: 0 });
  const nodoc = new Set<unknown>();
  for (const b of blocks) if (b.options.nodoc) b.children.forEach((c) => nodoc.add(c));
  const docTree: Root = { type: "root", children: tree.children.filter((c) => !nodoc.has(c)) };
  diagnostics.push(...validateLabels(docTree, fullRegistry, data, locate));
  if (diagnostics.some((d) => d.severity === "error")) throw new SlideDirectiveError(diagnostics);

  // Image URLs are rewritten once, up front.
  const imageUrls = new Set<string>();
  for (const b of blocks) {
    for (const child of b.children) {
      visit(child as any, "image", (img: any) => {
        if (options.resolveUrl) img.url = options.resolveUrl(img.url);
        imageUrls.add(img.url);
      });
    }
  }

  const config = resolveCitationConfig(options.citations);
  const maxHeadings = options.maxHeadings ?? 2;
  const onSlides = new Set<string>();
  for (const b of blocks) for (const l of labelsOf(b.children)) onSlides.add(l.toLowerCase());

  // Provisional numbering, so cross-references measure close to their final width.
  const provisionalRoot = rootOf(blocks.flatMap((b) => b.children));
  // Only labels something refers to are numbered; the rest show just their caption.
  const provisionalRefs = new Set(xrefsOf(provisionalRoot.children).map((l) => l.toLowerCase()));
  const provisional = buildRegistry(provisionalRoot, { numberingDepth: 0, visibleLabels: provisionalRefs });
  const formatted = new Map<string, RefEntry>();
  const formatKey = (key: string): RefEntry | undefined => {
    if (!options.bibliography) return undefined;
    if (formatted.has(key)) return formatted.get(key);
    const entry = options.bibliography.get(key);
    if (!entry) return undefined;
    const ref = formatReference(entry, config.referenceStyle);
    formatted.set(key, ref);
    return ref;
  };
  const definitions = tree.children.filter((n) => n.type === "definition") as Block[];
  const provisionalCtx: SlideRenderContext = {
    definitions,
    registry: provisional,
    bibliography: options.bibliography,
    citations: options.citations,
    citeKeys: [...new Set(citeKeysIn(provisionalRoot.children))],
    numberOf: new Map(),
  };
  provisionalCtx.citeKeys.forEach((k, i) => provisionalCtx.numberOf.set(k, i + 1));

  // ── Stage 4: group blocks into content slides, agendas and divider runs ────
  const entries: Entry[] = [];
  let run: SlideBlock[] = [];
  const flush = () => {
    if (run.length) entries.push({ kind: "divider", blocks: run });
    run = [];
  };
  for (const b of blocks) {
    if (!isDividerBlock(b)) {
      flush();
      entries.push({ kind: "content", block: b });
    } else if (contentOf(b).length === 0) {
      // A title-only block is always its own slide and never joins an agenda.
      flush();
      entries.push({ kind: "divider", blocks: [b] });
    } else if (b.title !== undefined) {
      flush();
      entries.push({ kind: "agenda", block: b });
    } else {
      const prev = run[run.length - 1];
      const same =
        !prev ||
        (prev.options.nodoc === b.options.nodoc &&
          prev.options.steplists === b.options.steplists &&
          prev.options.stepleadin === b.options.stepleadin);
      if (!same) flush();
      run.push(b);
    }
  }
  flush();

  // ── Stages 2, 3, 5: titles, pruning, filtering and splitting ───────────────
  const env: SplitEnv = {
    fits: (slide) => (options.measure ?? estimateFits)(slide, () => renderSlide(slide, provisionalCtx)),
    diagnostics,
    placedOn: new Map(),
    shown: new Set(),
    refsFor: (keys) => keys.map(formatKey).filter((r): r is RefEntry => !!r),
    draftCounter: { value: 0 },
  };
  const slides: Slide[] = [];
  const cover = coverSlide(content);
  if (cover) slides.push(cover);

  // Paragraph reduction: `paragraphs:` and `lang:` in the front matter, statistics over the whole file.
  let header: Record<string, unknown> = {};
  try {
    header = parseFrontmatter(content).data;
  } catch {
    /* a broken header is reported by whoever renders it */
  }
  // `theme-color`: only a valid color reaches the stylesheet (REQ-103); otherwise warn and keep the defaults (REQ-104).
  let themeColor: string | undefined;
  try {
    const raw = parseFrontmatter(content).meta.themeColor;
    if (raw !== undefined) {
      themeColor = parseThemeColor(raw);
      if (!themeColor) {
        const line = Math.max(1, content.split("\n").findIndex((l) => /^theme-?color\s*:/i.test(l)) + 1);
        diagnostics.push({
          code: "theme-color",
          severity: "warning",
          message: `theme-color "${raw}" is not a color (use #rrggbb, rgb(), hsl() or a color name); the default colors are used`,
          loc: options.sourceMap?.[line - 1] ?? { line },
        });
      }
    }
  } catch {
    /* a broken header is reported by whoever renders it */
  }
  let paragraphMode: ParagraphsMode = options.paragraphs ?? "auto";
  if (!options.paragraphs && header.paragraphs !== undefined) {
    const wanted = String(header.paragraphs);
    if ((PARAGRAPH_MODES as readonly string[]).includes(wanted)) paragraphMode = wanted as ParagraphsMode;
    else {
      diagnostics.push({
        code: "paragraph-mode",
        severity: "warning",
        message: `unknown paragraphs mode "${wanted}"; use ${PARAGRAPH_MODES.join(", ")}. Using "auto".`,
      });
    }
  }
  const docStats = buildDocStats(tree, typeof header.lang === "string" ? header.lang : undefined);

  const prepare = (block: SlideBlock): PreparedBlock => {
    const { title, titleSource, titleLine } = resolveTitle(block);
    const headingText = inlineText(title.length > 0 ? title : (block.headingInEffect?.inline ?? []));
    const { units, strandedHeadings, startNotes } = buildUnits(block.children, locate, (para) =>
      reduceParagraph(para, { stats: docStats, mode: paragraphMode, headingText })
    );
    for (const hd of strandedHeadings) {
      diagnostics.push({
        code: "heading-stranded",
        severity: "warning",
        message: "a heading with nothing after it was dropped",
        loc: locate(hd.position?.start.line ?? block.loc.line),
      });
    }
    let minDepth = 6;
    for (const child of block.children) if (isHeading(child)) minDepth = Math.min(minDepth, child.depth);
    if (minDepth === 6 && !block.children.some((c) => isHeading(c) && c.depth === 6)) minDepth = 1;

    // Early drop: references to targets in no @slide block, and everything under noxrefs.
    const droppedItems = new Set<ListItem>();
    for (const u of units) {
      const leaf = u.parts[u.parts.length - 1];
      if (leaf.kind === "item" && leaf.chain.some((c) => droppedItems.has(c.item))) {
        u.dropped = "parent item dropped";
        droppedItems.add(leaf.chain[leaf.chain.length - 1].item);
        continue;
      }
      if (!u.filterable || u.xrefs.length === 0) continue;
      let reason: string | undefined;
      let label: string | undefined;
      if (block.options.noxrefs) {
        reason = "noxrefs drops every cross-reference unit";
        label = u.xrefs[0];
      } else {
        label = u.xrefs.find((x) => !onSlides.has(x.toLowerCase()));
        if (label) reason = "its target is not on any slide";
      }
      if (!reason) continue;
      u.dropped = reason;
      if (leaf.kind === "item") droppedItems.add(leaf.chain[leaf.chain.length - 1].item);
      diagnostics.push({
        code: "drop-xref",
        severity: "info",
        message: `dropped a unit referencing "${label}": ${reason}`,
        loc: u.loc,
      });
    }
    // What follows each drop may begin with "This" or "It".
    units.forEach((u, i) => {
      if (!u.dropped || u.dropped === "parent item dropped") return;
      const next = units.slice(i + 1).find((x) => !x.dropped);
      if (next) {
        diagnostics.push({
          code: "drop-follows",
          severity: "info",
          message: `kept text follows a dropped unit and may read oddly: "${snippet(next)}"`,
          loc: next.loc,
        });
      }
    });
    const byGroup = new Map<object, Unit[]>();
    for (const u of units) byGroup.set(u.group, [...(byGroup.get(u.group) ?? []), u]);
    for (const group of byGroup.values()) {
      if (group.length > 0 && group.every((u) => u.dropped)) {
        diagnostics.push({
          code: "drop-all",
          severity: "warning",
          message: "a paragraph or list disappeared entirely",
          loc: group[0].loc,
        });
      }
    }
    // The notes of a dropped unit stay with what came before it.
    const survivors: Unit[] = [];
    for (const u of units) {
      if (!u.dropped) survivors.push(u);
      else (survivors.length > 0 ? survivors[survivors.length - 1].notes : startNotes).push(...u.notes);
    }
    return { block, title, titleSource, titleLine, units: survivors, minDepth, startNotes };
  };

  const dividerSlide = (blocks: SlideBlock[]): Slide => {
    const first = blocks[0];
    const entriesOut: Array<{ depth: number | undefined; inline: Inline[]; node?: Heading; line?: number }> = [];
    for (const b of blocks) {
      if (b.options.layout || b.options.showrefs || b.options.noxrefs) {
        diagnostics.push({
          code: "layout-ignored",
          severity: "warning",
          message: "layout, showrefs and noxrefs are ignored on a divider or agenda",
          loc: b.loc,
        });
      }
      if (contentOf(b).length === 0) {
        // A title-only block is always alone in its run: one large title.
        const t = resolveTitle(b);
        if (t.title.length === 0) continue;
        entriesOut.push({ depth: undefined, inline: t.title, line: b.openLine });
      } else {
        for (const c of contentOf(b) as Heading[]) {
          entriesOut.push({ depth: c.depth, inline: c.children as Inline[], node: c });
        }
      }
    }
    for (const b of blocks.slice(0, -1)) {
      if (b.leadin) {
        diagnostics.push({
          code: "leadin-dropped",
          severity: "warning",
          message: "a merged divider run kept only the last lead-in",
          loc: b.endLoc,
        });
      }
    }
    const leadin = blocks[blocks.length - 1].leadin;
    const real = entriesOut.map((e) => e.depth).filter((d): d is number => d !== undefined);
    const min = real.length > 0 ? Math.min(...real) : 1;
    for (const e of entriesOut) e.depth ??= min;
    let title: Inline[] = [];
    let titleSource: Slide["titleSource"] = "none";
    let titleLine: number | undefined;
    let body: Block[];
    const isAgenda = blocks.length === 1 && first.title !== undefined && contentOf(first).length > 0;
    if (isAgenda) {
      title = first.title!;
      titleSource = "override";
      titleLine = first.openLine;
    }
    if (entriesOut.length === 1 && !isAgenda) {
      body = [{ type: "heading", depth: 1, children: entriesOut[0].inline as any, position: entriesOut[0].node?.position ?? atLine(entriesOut[0].line), data: { hProperties: { className: ["vfm-divider-title"] } } } as Heading];
    } else {
      if (!isAgenda) {
        for (let d = min - 1; d >= 1; d--) {
          const anc = first.headingStack[d - 1];
          if (anc) {
            title = plainInline(anc.inline);
            titleSource = "heading";
            titleLine = anc.line;
            break;
          }
        }
      }
      // Nested list by relative heading depth.
      const root: List = { type: "list", ordered: false, spread: false, children: [] };
      const stack: List[] = [root];
      let level = 0;
      for (const e of entriesOut) {
        let want = Math.min(Math.max(0, e.depth! - min), stack.length);
        while (stack.length > want + 1) stack.pop();
        level = stack.length - 1;
        if (want > level && stack[level].children.length === 0) want = level;
        if (want > level) {
          const parent = stack[stack.length - 1].children;
          const owner = parent[parent.length - 1];
          const nested: List = { type: "list", ordered: false, spread: false, children: [] };
          owner.children.push(nested);
          stack.push(nested);
        }
        stack[stack.length - 1].children.push({
          type: "listItem",
          spread: false,
          position: e.node?.position,
          children: [{ type: "paragraph", children: e.inline as any }],
        });
      }
      body = [root];
    }
    return {
      kind: "slide",
      title,
      titleSource,
      titleLine,
      continuation: { index: 1, of: 1 },
      layout: "single",
      context: [],
      body,
      images: [],
      references: [],
      leadin,
      leadinLine: leadin ? blocks[blocks.length - 1].closeLine : undefined,
      steps: [[]],
      sourceBlock: first,
      divider: true,
      labels: new Set(),
      notes: blocks.flatMap(notesOf),
    };
  };

  for (const entry of entries) {
    if (entry.kind === "divider") {
      slides.push(dividerSlide(entry.blocks));
      continue;
    }
    if (entry.kind === "agenda") {
      slides.push(dividerSlide([entry.block]));
      continue;
    }
    const prepared = prepare(entry.block);
    const drafts = splitBlock(prepared, env);
    const made = drafts.map((d, i) => {
      const s = toSlide(d, env, i === drafts.length - 1);
      s.continuation = { index: i + 1, of: drafts.length };
      return s;
    });
    // A block with several sections that spans several slides: each slide is titled by the heading it
    // starts with (a `[title]` on the block, or a block that fits on one slide under a heading in effect,
    // keeps its title). Continuation counts then run per title, so "(2/3)" means the same section.
    if (entry.block.title === undefined && (made.length > 1 || prepared.titleSource === "none")) {
      for (const s of made) {
        const lead = s.body[0];
        const next = s.body[1];
        // A run of same-level headings with nothing between them is a list of sections, not a title.
        const siblingRun = next?.type === "heading" && (next as Heading).depth === (lead as Heading).depth;
        if (lead?.type === "heading" && !siblingRun && !(lead.data as any)?.label) {
          s.title = plainInline(lead.children as Inline[]);
          s.titleSource = "heading";
          s.titleLine = lead.position?.start.line ?? s.titleLine;
          s.body = s.body.slice(1);
          s.context = s.context.filter((c) => !(c.kind === "heading" && c.continued));
        }
      }
      const key = (s: Slide) => inlineText(s.title);
      for (let i = 0; i < made.length; ) {
        let j = i;
        while (j + 1 < made.length && key(made[j + 1]) === key(made[i])) j++;
        for (let k = i; k <= j; k++) made[k].continuation = { index: k - i + 1, of: j - i + 1 };
        i = j + 1;
      }
    }
    if (made.length === 0 && prepared.units.length === 0 && contentOf(entry.block).length > 0) {
      diagnostics.push({ code: "drop-all", severity: "warning", message: "the whole @slide block was dropped", loc: entry.block.loc });
    }
    if (made.length > 1) {
      diagnostics.push({ code: "split", severity: "info", message: `this @slide block continues onto ${made.length} slides`, loc: entry.block.loc });
    }
    if (
      (entry.block.options.layout === "rtext" || entry.block.options.layout === "ltext") &&
      made.every((s) => s.images.length === 0)
    ) {
      diagnostics.push({ code: "layout-no-image", severity: "info", message: "rtext/ltext with no images or floats renders as a single column", loc: entry.block.loc });
    }
    for (const s of made) {
      let headings = 0;
      for (const b of s.body) {
        if (b.type === "heading" && !((b.data as any)?.hProperties?.className ?? []).includes("vfm-continued")) headings++;
      }
      if (headings > maxHeadings) {
        diagnostics.push({
          code: "too-many-headings",
          severity: "warning",
          message: `this slide holds ${headings} headings (more than ${maxHeadings})`,
          loc: entry.block.loc,
        });
      }
    }
    slides.push(...made);
  }

  // ── Stage 6: number and resolve deck-wide ──────────────────────────────────
  // A label is numbered only if a reference to it survived onto the same slide.
  const referenced = new Set<string>();
  for (const s of slides) {
    for (const label of xrefsOf([...s.body, ...s.images])) {
      if (s.labels.has(label) || [...s.labels].some((l) => l.toLowerCase() === label.toLowerCase())) {
        referenced.add(label.toLowerCase());
      }
    }
  }
  const registry = buildRegistry(rootOf(slides.flatMap((s) => [...s.body, ...s.images])), {
    numberingDepth: 0,
    visibleLabels: referenced,
  });
  const citeKeys = [...new Set(slides.flatMap((s) => citeKeysIn([...s.body, ...s.images])))];
  const known = citeKeys.map(formatKey).filter((r): r is RefEntry => !!r);
  const ordered = sortReferences(known, config.sort);
  const numberOf = new Map(ordered.map((r, i) => [r.citeKey, i + 1]));
  const shown = new Set<string>();
  for (const s of slides) {
    s.references = [];
    if (s.divider || !s.sourceBlock.options.showrefs) continue;
    const keys = [...new Set(citeKeysIn([...s.body, ...s.images]))].filter((k) => !shown.has(k));
    const refs = keys.map(formatKey).filter((r): r is RefEntry => !!r);
    s.references = sortReferences(refs, config.sort);
    keys.forEach((k) => shown.add(k));
  }

  // Cross-references that could not be resolved and were left as text.
  for (const s of slides) {
    for (const label of new Set(xrefsOf([...s.body, ...s.images]))) {
      if (!s.labels.has(label) && !s.labels.has(label.toLowerCase())) {
        diagnostics.push({
          code: "xref-in-table-or-code",
          severity: "warning",
          message: `the reference to "${label}" cannot resolve on this slide and renders as plain text`,
          loc: s.sourceBlock.loc,
        });
      }
    }
  }

  for (const s of slides) {
    const seen = new Set<string>();
    const mine = new Set(
      s.sourceBlock.children.filter((n) => n.type === "footnoteDefinition").map((n) => (n as any).identifier as string)
    );
    for (const part of [...s.body, ...s.images]) {
      const missing = (id: string, label: string) => {
        if (mine.has(id) || seen.has(id)) return;
        seen.add(id);
        diagnostics.push({
          code: "unknown-footnote",
          severity: "warning",
          message: `footnote "${label}" is not defined inside this @slide block, so it is not shown`,
          loc: s.sourceBlock.loc,
        });
      };
      visit(part as any, "footnoteReference", (n: any) => missing(n.identifier, n.label ?? n.identifier));
      // Without a definition the parser leaves `[^x]` as plain text.
      visit(part as any, "text", (n: any) => {
        for (const m of n.value.matchAll(/\[\^([^\]\s]+)\]/g)) missing(m[1].toLowerCase(), m[1]);
      });
    }
  }

  // ── Stage 7: reveal steps (annotation only) ────────────────────────────────
  slides.forEach((s, index) => assignSteps(s, index, diagnostics));

  return {
    slides,
    diagnostics,
    registry,
    render: { registry, bibliography: options.bibliography, citations: options.citations, citeKeys, numberOf, definitions, themeColor },
    imageUrls: [...imageUrls],
  };
}

function affiliationText(a: Affiliation): string {
  const place = [a.city, a.region, a.country].filter(Boolean).join(", ");
  return [a.department, a.name, place].filter(Boolean).join(", ");
}

/** The title slide: title, subtitle, authors and date from the YAML header. */
function coverSlide(content: string): Slide | undefined {
  let meta;
  try {
    meta = parseFrontmatter(content).meta;
  } catch {
    return undefined; // a broken header is reported by whoever renders it
  }
  if (!meta.title) return undefined;
  // Affiliations are numbered in order of first appearance across authors.
  const affiliations: Affiliation[] = [];
  const numberOf = (a: Affiliation) => {
    let i = affiliations.findIndex((x) => x === a || (x.name === a.name && x.department === a.department));
    if (i < 0) i = affiliations.push(a) - 1;
    return i + 1;
  };
  const authors = meta.authors.map((a) => ({ name: a.name, affiliations: a.affiliations.map(numberOf) }));
  // A top-level list that no author refers to is shown as it is, without numbers (REQ-114).
  const numbered = affiliations.length > 0;
  if (!numbered) affiliations.push(...meta.affiliations);
  const block: SlideBlock = {
    kind: "slideBlock",
    id: -1,
    options: { showrefs: false, nodoc: false, noxrefs: false, steplists: false, stepleadin: false },
    headingStack: [],
    children: [],
    loc: { line: 1 },
    endLoc: { line: 1 },
    openLine: 1,
    closeLine: 1,
  };
  return {
    kind: "slide",
    title: [],
    titleSource: "none",
    continuation: { index: 1, of: 1 },
    layout: "single",
    context: [],
    body: [],
    images: [],
    references: [],
    steps: [[]],
    sourceBlock: block,
    labels: new Set(),
    notes: [],
    cover: {
      title: meta.title,
      subtitle: meta.subtitle,
      authors,
      affiliations: affiliations.map(affiliationText),
      numbered,
      date: meta.date,
    },
  };
}

function assignSteps(slide: Slide, index: number, diagnostics: Diagnostic[]) {
  const { steplists, stepleadin } = slide.sourceBlock.options;
  if (!steplists && !stepleadin) return;
  let k = 0;
  let hasList = false;
  const visitList = (list: List) => {
    for (const item of list.children) {
      if (((item.data as any)?.hProperties?.className ?? []).includes("vfm-context")) {
        for (const c of item.children) if (c.type === "list") visitList(c);
        continue;
      }
      hasList = true;
      k++;
      item.data = { ...(item.data ?? {}), hProperties: { ...((item.data as any)?.hProperties ?? {}), "data-step": k } } as any;
      (slide.steps[k] ??= []).push(`${index}.${k}`);
      for (const c of item.children) if (c.type === "list") visitList(c);
    }
  };
  if (steplists) for (const b of slide.body) if (b.type === "list") visitList(b);
  if (steplists && !hasList) {
    diagnostics.push({ code: "step-noop", severity: "info", message: "steplists has no lists to step through", loc: slide.sourceBlock.loc });
  }
  if (stepleadin) {
    if (slide.leadin) {
      slide.leadinStep = k + 1;
      (slide.steps[k + 1] ??= []).push(`${index}.leadin`);
    } else if (slide.continuation.index === slide.continuation.of) {
      diagnostics.push({ code: "step-noop", severity: "info", message: "stepleadin has no lead-in to reveal", loc: slide.sourceBlock.loc });
    }
  }
}

/** All diagnostics for a document, without rendering. Fatal ones come back like the rest. */
export function checkSlides(content: string, options: SlideDeckOptions = {}): Diagnostic[] {
  try {
    return buildSlideDeck(content, options).diagnostics;
  } catch (err) {
    if (err instanceof SlideDirectiveError) return err.diagnostics;
    throw err;
  }
}
