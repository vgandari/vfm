/**
 * slides/render.ts
 *
 * One slide as a React element. The structure is fixed so the stylesheet
 * (slides.css) and the fit measurer agree on it:
 *
 *   <section class="vfm-slide vfm-layout-…">
 *     <header class="vfm-slide-title">…</header>
 *     <div class="vfm-slide-content vfm-fit">…</div>      single / 2col
 *     <div class="vfm-slide-content"> text | images </div>  rtext / ltext
 *     <ol class="vfm-slide-refs">…</ol>                    under showrefs
 *     <footer class="vfm-slide-leadin">…</footer>
 *   </section>
 *
 * Every region that can overflow carries `vfm-fit`. Items revealed by steps
 * carry `data-step="k"`; the host shows those with k ≤ the current step.
 */

import { isDarkColor } from "./themeColor";
import { createElement as h } from "react";
import type { CSSProperties, ReactElement } from "react";
import type { FootnoteDefinition, List } from "mdast";
import { visit } from "unist-util-visit";
import { renderTree } from "../pipeline";
import { NormalizedRegistry } from "../registry";
import { referenceItem } from "../plugins/citations";
import { resolveCitationConfig, CitationStyle, type BibliographyMap, type CitationConfig } from "../bibliography";
import type { Block, Inline, Slide } from "./types";
import { rootOf } from "./units";

export interface SlideRenderContext {
  /** Deck-wide numbering. */
  registry: NormalizedRegistry;
  bibliography?: BibliographyMap;
  citations?: CitationConfig;
  /** Cite keys of the deck in order of first appearance. */
  citeKeys: string[];
  /** Reference number by cite key (numbered citation styles). */
  numberOf: Map<string, number>;
  /** Link reference definitions, looked up document-wide so `[text][ref]` works on any slide. */
  definitions: Block[];
  /** Validated accent color from the YAML header (`theme-color`). */
  themeColor?: string;
  /** Validated `separator-color`: the rule under slide titles (default: `themeColor`). */
  separatorColor?: string;
  /** Validated `section-color`: background of section slides (default: a tint of `themeColor`). */
  sectionColor?: string;
}

/** `data-line` for a region whose text was written on one line of the source (REQ-161, REQ-162). */
const lineAttr = (line: number | undefined) => (line ? { "data-line": line } : {});

function sliceRegistry(registry: NormalizedRegistry, labels: Set<string>): NormalizedRegistry {
  const out = new NormalizedRegistry();
  for (const label of labels) {
    const entry = registry.get(label);
    if (entry) out.set(label, entry);
  }
  return out;
}

/** The presenter notes of one slide, as paragraphs; null when it has none. Never part of the slide itself. */
export function renderNotes(slide: Slide, ctx: SlideRenderContext): ReactElement | null {
  if (slide.notes.length === 0) return null;
  const registry = sliceRegistry(ctx.registry, slide.labels);
  const paragraphs = slide.notes.map((inline, i) =>
    h(
      "div",
      { key: i, className: "vfm-note" },
      renderTree(rootOf([{ type: "paragraph", children: inline }]), {
        registry,
        unresolved: "plain",
        bibliography: ctx.bibliography,
        citations: ctx.citations,
        citeKeys: ctx.citeKeys,
      })
    )
  );
  return h("div", { className: "vfm-notes" }, ...paragraphs);
}

/** Inline style that carries the theme color; the stylesheet derives the title rule and the tint from it. */
const themeStyle = (ctx: SlideRenderContext, extra: Record<string, string> = {}) => {
  const style: Record<string, string> = {
    ...(ctx.themeColor ? { "--vfm-slide-accent": ctx.themeColor } : {}),
    ...(ctx.separatorColor ? { "--vfm-slide-rule": ctx.separatorColor } : {}),
    ...extra,
  };
  return Object.keys(style).length ? { style: style as CSSProperties } : {};
};

function renderCover(slide: Slide, ctx: SlideRenderContext): ReactElement {
  const c = slide.cover!;
  // A title image replaces the background; otherwise the theme color is the background as it is, with light or dark text (REQ-107).
  const coverClass = c.image ? " vfm-cover-image" : ctx.themeColor ? ` vfm-cover-colored ${isDarkColor(ctx.themeColor) ? "vfm-on-dark" : "vfm-on-light"}` : "";
  return h(
    "section",
    {
      className: `vfm-slide vfm-cover${coverClass}`,
      "data-layout": "single",
      ...themeStyle(ctx, !c.image && ctx.themeColor ? { "--vfm-slide-cover-bg": ctx.themeColor } : {}),
    },
    c.image ? h("img", { className: "vfm-cover-bg", src: c.image, alt: "" }) : null,
    c.image ? h("div", { className: "vfm-cover-scrim" }) : null,
    h("h1", { className: "vfm-cover-title" }, c.title),
    c.subtitle ? h("p", { className: "vfm-cover-subtitle" }, c.subtitle) : null,
    c.authors.length > 0
      ? h(
          "p",
          { className: "vfm-cover-authors" },
          ...c.authors.flatMap((a, i) => [
            i > 0 ? ", " : null,
            h("span", { key: i, className: "vfm-cover-author" }, a.name, a.affiliations.length ? h("sup", null, a.affiliations.join(",")) : null),
          ])
        )
      : null,
    c.affiliations.length > 0
      ? h(
          "ol",
          { className: "vfm-cover-affiliations" },
          ...c.affiliations.map((a, i) => h("li", { key: i }, c.numbered ? [h("sup", { key: "n" }, i + 1), " "] : null, a))
        )
      : null,
    c.date ? h("p", { className: "vfm-cover-date" }, c.date) : null
  );
}

export function renderSlide(slide: Slide, ctx: SlideRenderContext, extra: { number?: number } = {}): ReactElement {
  if (slide.cover) return renderCover(slide, ctx);
  // Only this slide's own labels resolve; a reference to another slide is plain text.
  const registry = sliceRegistry(ctx.registry, slide.labels);
  // A slide carries the definitions its text uses. Footnotes are numbered per slide.
  const withDefinitions = (blocks: Block[]): Block[] => {
    const ids = new Set<string>();
    for (const b of blocks) visit(b as any, "footnoteReference", (n: any) => void ids.add(n.identifier));
    // Only footnotes written inside this slide's own @slide block are shown.
    const mine = slide.sourceBlock.children.filter(
      (n): n is FootnoteDefinition => n.type === "footnoteDefinition" && ids.has(n.identifier)
    );
    return [...blocks, ...ctx.definitions, ...mine];
  };
  const tree = (blocks: Block[]) =>
    renderTree(rootOf(withDefinitions(blocks)), {
      registry,
      unresolved: "plain",
      bibliography: ctx.bibliography,
      citations: ctx.citations,
      citeKeys: ctx.citeKeys,
    });
  const inline = (nodes: Inline[]) => tree([{ type: "paragraph", children: nodes }]);

  const cls = ["vfm-slide", `vfm-layout-${slide.layout}`];
  if (slide.divider) cls.push("vfm-divider");
  // Section slides use `section-color`, else the theme color, exactly as written (never tinted), with light or dark text.
  const sectionBg = slide.divider ? ctx.sectionColor ?? ctx.themeColor : undefined;
  if (sectionBg) cls.push("vfm-section-colored", isDarkColor(sectionBg) ? "vfm-on-dark" : "vfm-on-light");
  if (slide.continuation.of > 1) cls.push("vfm-continuation");

  const title =
    slide.title.length > 0
      ? h("header", { className: "vfm-slide-title", ...lineAttr(slide.titleLine) }, h("div", { className: "vfm-inline" }, inline(slide.title)),
          slide.continuation.of > 1
            ? h("span", { className: "vfm-cont" }, `(${slide.continuation.index}/${slide.continuation.of})`)
            : null)
      : h("header", { className: "vfm-slide-title vfm-empty" });

  const bodyEl = h("div", { className: "vfm-region vfm-body vfm-fit" }, tree(slide.body));
  let content: ReactElement;
  if (slide.layout === "rtext" || slide.layout === "ltext") {
    const imagesEl = h("div", { className: "vfm-region vfm-images vfm-fit" }, tree(slide.images));
    content = h(
      "div",
      { className: "vfm-slide-content" },
      ...(slide.layout === "rtext" ? [imagesEl, bodyEl] : [bodyEl, imagesEl])
    );
  } else if (slide.layout === "2col" && slide.images.length > 0) {
    // Images with no text beside them: one image per column (REQ-172).
    content = h(
      "div",
      { className: "vfm-slide-content" },
      ...slide.images.map((img, i) => h("div", { key: i, className: "vfm-region vfm-images vfm-fit" }, tree([img])))
    );
  } else {
    content = h("div", { className: "vfm-slide-content" }, bodyEl);
  }

  let refs: ReactElement | null = null;
  if (slide.references.length > 0) {
    const numbered = resolveCitationConfig(ctx.citations).citationStyle === CitationStyle.Number;
    const lists: List[] = slide.references.map((ref) => ({
      type: "list",
      ordered: numbered,
      start: numbered ? ctx.numberOf.get(ref.citeKey) ?? 1 : null,
      spread: false,
      children: [referenceItem(ref, null)],
    }));
    refs = h("div", { className: "vfm-slide-refs" }, tree(lists as unknown as Block[]));
  }

  const leadin = slide.leadin
    ? h("footer", { className: "vfm-slide-leadin", ...lineAttr(slide.leadinLine), ...(slide.leadinStep ? { "data-step": slide.leadinStep } : {}) },
        h("div", { className: "vfm-inline" }, inline(slide.leadin)))
    : null;

  const number =
    extra.number !== undefined ? h("div", { className: "vfm-slide-number" }, String(extra.number)) : null;
  return h("section", { className: cls.join(" "), "data-layout": slide.layout, ...themeStyle(ctx, {
        ...(sectionBg ? { "--vfm-slide-section-bg": sectionBg } : {}),
        ...(slide.tableScale !== undefined ? { "--vfm-table-scale": String(slide.tableScale) } : {}),
      }) }, title, content, refs, leadin, number);
}
