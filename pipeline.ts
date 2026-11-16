import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkRehype from "remark-rehype";
import rehypeRaw from "rehype-raw";
import rehypeHighlight from "rehype-highlight";
import rehypeReact from "rehype-react";
import * as prod from "react/jsx-runtime";
import { createElement } from "react";
import type { ComponentProps, ReactElement } from "react";
import type { Plugin } from "unified";
import type { Root } from "mdast";
import {
  preprocessFencedDivs,
  remarkFencedDivs,
} from "./plugins/fenced-divs";
import remarkHighlight from "./plugins/highlight";
import remarkUnderline from "./plugins/underline";
import remarkNoHtml from "./plugins/no-html";
import remarkEquationLabels from "./plugins/equation-labels";
import remarkLabels from "./plugins/labels";
import remarkAlerts from "./plugins/alerts";
import remarkHeadingShift from "./plugins/heading-shift";
import remarkPrependTitle from "./plugins/prepend-title";
import { injectUuid } from "./plugins/uuid-inject";
import { parseFrontmatter } from "./frontmatter";
export { parseFrontmatter, FrontmatterError } from "./frontmatter";
export type {
  Affiliation,
  Author,
  FrontmatterMeta,
  ParsedFrontmatter,
} from "./frontmatter";
import { VFile } from "vfile";
import remarkSlideBlocks, {
  preprocessSlideDirectives,
  type DirectiveStore,
  type SlideBlocksData,
} from "./slides/directives";
import { validateLabels } from "./slides/validate";
import type { SourceLoc } from "./slides/types";
import { SlideDirectiveError } from "./slides/types";
import { buildRegistry, collectXrefLabels, NormalizedRegistry } from "./registry";
export type { NormalizedRegistry };
import remarkCrossRefs from "./plugins/cross-refs";
import remarkSuppressLabels from "./plugins/suppress-labels";
import remarkCitations from "./plugins/citations";
import type { BibliographyMap, CitationConfig } from "./bibliography";
import {
  highlightHandler,
  headingHandler,
  shiftedHeadingHandler,
  paragraphHandler,
  tableHandler,
  codeHandler,
  mathHandler,
  inlineMathHandler,
  fencedDivHandler,
} from "./handlers";
import {
  preprocessAlgorithmBlocks,
  remarkAlgorithmBlocks,
  algorithmBlockHandler,
} from "./plugins/algorithm-blocks";
import AlgorithmPseudocode from "./AlgorithmPseudocode";
import {
  preprocessMusicBlocks,
  remarkMusicBlocks,
  musicBlockHandler,
} from "./plugins/music-blocks";
import MusicAbc from "./MusicAbc";
import {
  preprocessMermaidBlocks,
  remarkMermaidBlocks,
  mermaidBlockHandler,
} from "./plugins/mermaid-blocks";
import MermaidDiagram from "./MermaidDiagram";
import type { State } from "mdast-util-to-hast";
import { visit } from "unist-util-visit";

// ─── Shared options type ──────────────────────────────────────────────────────

export interface ParseOptions {
  numberingDepth?: number;
  headingShift?: number;
  id?: string | null;
  title?: string;
  titleLevel?: number;
  suppressUnreferencedLabels?: boolean;
  /**
   * Which figures, tables, listings, equations, algorithms, scores and environments get a number.
   * "all" (default): every labelled or captioned one. "referenced": only those a `[@label]`
   * cross-reference points to, numbered 1, 2, 3 with no gaps; the rest keep their caption, unnumbered.
   */
  numberCaptions?: "all" | "referenced";
  /**
   * Resolved entries for `@cite(key)`. When given, citations are rendered and
   * a References section is appended; when omitted, `@cite(...)` stays literal.
   */
  bibliography?: BibliographyMap;
  /** Entries are still being fetched: citations render as "(…)". */
  bibliographyPending?: boolean;
  /** Reference style, citation style and sort order. Defaults to APA. */
  citations?: CitationConfig;
  /**
   * Where each line of `content` came from (see expandIncludes), so slide
   * diagnostics can name the original file. Defaults to the line itself.
   */
  sourceMap?: SourceLoc[];
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function prepareSource(
  content: string,
  options: ParseOptions
): {
  source: string;
  store: ReturnType<typeof preprocessFencedDivs>["store"];
  algorithmStore: ReturnType<typeof preprocessAlgorithmBlocks>["store"];
  musicStore: ReturnType<typeof preprocessMusicBlocks>["store"];
  mermaidStore: ReturnType<typeof preprocessMermaidBlocks>["store"];
  directives: DirectiveStore;
} {
  const { id = null } = options;
  // Must run first: later preprocessors rewrite labels/fences in raw text and
  // must not see the YAML header. The header is only stripped here, never
  // rendered; callers read it with parseFrontmatter and render it themselves.
  const { content: body } = parseFrontmatter(content);
  // Lines the header took off the front. They are put back as blank lines, so every position in the
  // parsed tree is a line of the author's file (the preview relies on this for scroll sync and
  // jump-to-source) and the raw-source preprocessors below keep that true by preserving line counts.
  const offset = content.slice(0, content.length - body.length).split("\n").length - 1;
  const locate = (line: number): SourceLoc => options.sourceMap?.[line - 1] ?? { line };
  const uuidSource = "\n".repeat(offset) + injectUuid(body, id);
  const { source: slideSource, store: directives } = preprocessSlideDirectives(uuidSource, locate);
  const { source: algoSource, store: algorithmStore } = preprocessAlgorithmBlocks(slideSource);
  const { source: musicSource, store: musicStore } = preprocessMusicBlocks(algoSource);
  const { source: mermaidSource, store: mermaidStore } = preprocessMermaidBlocks(musicSource);
  const { source, store } = preprocessFencedDivs(mermaidSource);
  return { source, store, algorithmStore, musicStore, mermaidStore, directives };
}

function buildRemarkPipeline(
  source: string,
  store: ReturnType<typeof preprocessFencedDivs>["store"],
  algorithmStore: ReturnType<typeof preprocessAlgorithmBlocks>["store"],
  musicStore: ReturnType<typeof preprocessMusicBlocks>["store"],
  mermaidStore: ReturnType<typeof preprocessMermaidBlocks>["store"],
  options: ParseOptions,
  directives: DirectiveStore,
  mode: "document" | "analyze" = "document"
) {
  const { numberingDepth = 1, headingShift = 0, title, titleLevel = 1 } = options;

  let pipeline = unified()
    .use(remarkParse)
    .use(remarkGfm, { singleTilde: false })
    .use(remarkUnderline)
    .use(remarkFencedDivs, { store })
    .use(remarkNoHtml)
    .use(remarkAlgorithmBlocks, { store: algorithmStore })
    .use(remarkMusicBlocks, { store: musicStore })
    .use(remarkMermaidBlocks, { store: mermaidStore })
    .use(remarkAlerts)
    .use(remarkHighlight)
    .use(remarkMath)
    .use(remarkEquationLabels);

  if (title) {
    pipeline = pipeline.use(remarkPrependTitle, { title, titleLevel });
  }

  pipeline = pipeline
    .use(remarkHeadingShift, { shift: headingShift })
    .use(remarkLabels)
    .use(remarkSlideBlocks, { store: directives, mode });

  if (mode === "analyze") return pipeline;

  pipeline = pipeline
    .use(remarkRegistryPlugin({ numberingDepth, suppressUnreferencedLabels: options.suppressUnreferencedLabels, numberCaptions: options.numberCaptions }, directives.locate, buildRegistry));

  return pipeline;
}

function remarkRegistryPlugin(
  opts: { numberingDepth: number; suppressUnreferencedLabels?: boolean; numberCaptions?: "all" | "referenced" },
  directivesLocate: DirectiveStore["locate"],
  _buildRegistry: typeof buildRegistry
): Plugin<[], Root> {
  return function () {
    return (tree: Root, file: any) => {
      file.data.registry = _buildRegistry(tree, {
        numberingDepth: opts.numberingDepth,
        suppressUnreferencedLabels: opts.suppressUnreferencedLabels,
        // Only what a cross-reference in the document points to is numbered.
        visibleLabels: opts.numberCaptions === "referenced" ? collectXrefLabels(String(file.value)) : undefined,
      }, String(file.value));
      // Slide directives are opt-in: only documents that use them get checked.
      const slides = file.data.slideBlocks as SlideBlocksData | undefined;
      if (slides && slides.blocks.length > 0) {
        const found = validateLabels(tree, file.data.registry, slides, directivesLocate);
        if (found.some((d) => d.severity === "error")) throw new SlideDirectiveError(found);
      }
    };
  };
}

// ─── collectRegistry ─────────────────────────────────────────────────────────

export function collectRegistry(
  content: string,
  options: ParseOptions = {}
): NormalizedRegistry {
  const { source, store, algorithmStore, musicStore, mermaidStore, directives } = prepareSource(content, options);
  const processor = buildRemarkPipeline(source, store, algorithmStore, musicStore, mermaidStore, options, directives);
  const file = new VFile({ value: source });
  const tree = processor.parse(file);
  processor.runSync(tree, file);
  return (file.data as any).registry as NormalizedRegistry ?? new NormalizedRegistry();
}

// ─── collectCitations ────────────────────────────────────────────────────────

/** Cite keys used by `@cite(...)` in the document, in order of first appearance. */
export function collectCitations(
  content: string,
  options: ParseOptions = {}
): string[] {
  const { source, store, algorithmStore, musicStore, mermaidStore, directives } = prepareSource(content, options);
  const processor = buildRemarkPipeline(source, store, algorithmStore, musicStore, mermaidStore, options, directives)
    .use(remarkCitations);
  const file = new VFile({ value: source });
  const tree = processor.parse(file);
  processor.runSync(tree, file);
  return ((file.data as any).citeKeys as string[] | undefined) ?? [];
}

// ─── mergeRegistries ─────────────────────────────────────────────────────────

export function mergeRegistries(
  registries: NormalizedRegistry[]
): NormalizedRegistry {
  const merged = new NormalizedRegistry();
  for (const registry of registries) {
    for (const key of registry.keys()) {
      const entry = registry.get(key);
      if (entry) merged.set(key, entry);
    }
  }
  return merged;
}

// ─── Source lines ─────────────────────────────────────────────────────────────

/** Custom handlers build elements from scratch; give each the position of the node it came from. */
function withPositions(handlers: Record<string, any>): Record<string, any> {
  return Object.fromEntries(
    Object.entries(handlers).map(([type, handler]) => [
      type,
      (state: State, node: any, parent: any) => {
        const result = handler(state, node, parent);
        if (result && !Array.isArray(result) && result.type === "element" && !result.position && node.position) {
          result.position = node.position;
        }
        return result;
      },
    ])
  );
}

const LINE_TAGS = new Set(["p", "li", "pre", "table", "blockquote", "div", "ul", "ol", "hr", "h1", "h2", "h3", "h4", "h5", "h6", "tr"]);

/** Marks block elements with `data-line` (1-based line in the author's file), for scroll sync and jump-to-source. */
function rehypeSourceLines() {
  return (tree: any) => {
    visit(tree, "element", (el: any) => {
      const line = el.position?.start?.line;
      if (line && LINE_TAGS.has(el.tagName) && el.properties?.dataLine === undefined) {
        el.properties = { ...(el.properties ?? {}), dataLine: line };
      }
    });
  };
}

// ─── Shared tail: mdast → hast → React ────────────────────────────────────────

function finishProcessor(pipeline: any): any {
  return pipeline
    .use(remarkRehype, {
      allowDangerousHtml: true,
      handlers: withPositions({
        highlight: highlightHandler,
        heading: headingHandler,
        shiftedHeading: shiftedHeadingHandler,
        paragraph: paragraphHandler,
        table: tableHandler,
        code: codeHandler,
        math: mathHandler,
        inlineMath: inlineMathHandler,
        fencedDiv: fencedDivHandler,
        algorithmBlock: algorithmBlockHandler,
        musicBlock: musicBlockHandler,
        mermaidBlock: mermaidBlockHandler,
        alertTitle: (_state: State, node: any) => ({
          type: "element",
          tagName: "p",
          properties: { className: ["alert-title"] },
          children: _state.all(node),
        }),
      }),
    })
    .use(rehypeSourceLines)
    .use(rehypeRaw)
    .use(rehypeHighlight)
    .use(rehypeReact, {
      Fragment: prod.Fragment,
      jsx: prod.jsx,
      jsxs: prod.jsxs,
      components: {
        "algorithm-pseudocode": AlgorithmPseudocode,
        "music-abc": MusicAbc,
        "mermaid-diagram": MermaidDiagram,
        input: TaskCheckbox,
      },
    });
}

// ─── renderMarkdown ───────────────────────────────────────────────────────────

export function renderMarkdown(
  content: string,
  options: ParseOptions = {},
  registry?: NormalizedRegistry
): ReactElement {
  const { source, store, algorithmStore, musicStore, mermaidStore, directives } = prepareSource(content, options);

  const resolvedRegistry =
    registry ?? collectRegistry(content, options);

  let pipeline = buildRemarkPipeline(source, store, algorithmStore, musicStore, mermaidStore, options, directives)
    .use(remarkCrossRefs, { registry: resolvedRegistry, id: options.id });

  if (options.suppressUnreferencedLabels) {
    pipeline = pipeline.use(remarkSuppressLabels);
  }

  if (options.bibliography || options.bibliographyPending) {
    // The References section sits at the level of the document's top-level
    // sections: `#` headings are shifted by headingShift.
    pipeline = pipeline.use(remarkCitations, {
      bibliography: options.bibliography,
      pending: options.bibliographyPending,
      config: options.citations,
      id: options.id,
      headingDepth: 1 + (options.headingShift ?? 0),
    });
  }

  const processor = finishProcessor(pipeline);

  const file = processor.processSync(source);
  return file.result as ReactElement;
}

// ─── Task list checkboxes ─────────────────────────────────────────────────────
// remark-gfm emits `<input type="checkbox" disabled>`, and browsers always gray
// out disabled checkboxes. Render them enabled (so they take the system accent
// color) but inert; CSS adds pointer-events: none.

function TaskCheckbox({ disabled: _disabled, node: _node, ...props }: ComponentProps<"input"> & { node?: unknown }) {
  if (props.type !== "checkbox") return createElement("input", { ...props, disabled: _disabled });
  return createElement("input", { ...props, readOnly: true, tabIndex: -1 });
}

// ─── parseMarkdown ────────────────────────────────────────────────────────────

export function parseMarkdown(
  content: string,
  options: ParseOptions = {}
): ReactElement {
  return renderMarkdown(content, options);
}

// ─── Slide support ────────────────────────────────────────────────────────────

/** What the slide builder needs from the parser: the labelled tree before numbering, plus the blocks. */
export function parseForSlides(
  content: string,
  options: ParseOptions = {}
): { tree: Root; data: SlideBlocksData; file: VFile; locate: DirectiveStore["locate"] } {
  const { source, store, algorithmStore, musicStore, mermaidStore, directives } = prepareSource(content, options);
  const processor = buildRemarkPipeline(source, store, algorithmStore, musicStore, mermaidStore, options, directives, "analyze");
  const file = new VFile({ value: source });
  const tree = processor.parse(file);
  processor.runSync(tree, file);
  const data = (file.data as any).slideBlocks as SlideBlocksData;
  return { tree, data, file, locate: directives.locate };
}

export interface RenderTreeOptions {
  registry: NormalizedRegistry;
  /** Unresolvable cross-references: plain text (slides) or red (default). */
  unresolved?: "plain" | "red";
  bibliography?: BibliographyMap;
  citations?: CitationConfig;
  /** Cite keys of the whole deck in order of first appearance; numbers follow it. */
  citeKeys?: string[];
}

/** Renders an already-numbered mdast tree (a slide's content). The tree is not modified. */
export function renderTree(tree: Root, options: RenderTreeOptions): ReactElement {
  const copy = structuredClone(tree);
  let pipeline: any = unified()
    .use(remarkCrossRefs, { registry: options.registry, id: null, unresolved: options.unresolved ?? "red" });
  if (options.bibliography) {
    pipeline = pipeline.use(remarkCitations, {
      bibliography: options.bibliography,
      config: options.citations,
      id: null,
      deckKeys: options.citeKeys ?? [],
      appendReferences: false,
    });
  }
  const processor = finishProcessor(pipeline);
  const file = new VFile();
  const hast = processor.runSync(copy, file);
  return processor.stringify(hast, file) as ReactElement;
}

// ─── Document tree (for exports) ──────────────────────────────────────────────

/**
 * The numbered, cross-referenced mdast tree of a document, as renderMarkdown sees it before it
 * becomes HTML. Exporters walk this instead of the DOM. `@slide` wrappers are transparent.
 */
export function parseDocument(
  content: string,
  options: ParseOptions = {}
): { tree: Root; registry: NormalizedRegistry } {
  const { source, store, algorithmStore, musicStore, mermaidStore, directives } = prepareSource(content, options);
  const registry = collectRegistry(content, options);
  let pipeline: any = buildRemarkPipeline(source, store, algorithmStore, musicStore, mermaidStore, options, directives)
    .use(remarkCrossRefs, { registry, id: options.id });
  if (options.bibliography || options.bibliographyPending) {
    pipeline = pipeline.use(remarkCitations, {
      bibliography: options.bibliography,
      pending: options.bibliographyPending,
      config: options.citations,
      id: options.id,
      headingDepth: 1 + (options.headingShift ?? 0),
    });
  }
  const file = new VFile({ value: source });
  const tree = pipeline.parse(file);
  pipeline.runSync(tree, file);
  return { tree, registry };
}
