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
import { buildRegistry, NormalizedRegistry } from "./registry";
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
import MusicAbc from "./MusicAbc";          // ← was MusicAbcNotation
import type { State } from "mdast-util-to-hast";

// ─── Shared options type ──────────────────────────────────────────────────────

export interface ParseOptions {
  numberingDepth?: number;
  headingShift?: number;
  id?: string | null;
  title?: string;
  titleLevel?: number;
  suppressUnreferencedLabels?: boolean;
  /**
   * Resolved entries for `@cite(key)`. When given, citations are rendered and
   * a References section is appended; when omitted, `@cite(...)` stays literal.
   */
  bibliography?: BibliographyMap;
  /** Entries are still being fetched: citations render as "(…)". */
  bibliographyPending?: boolean;
  /** Reference style, citation style and sort order. Defaults to APA. */
  citations?: CitationConfig;
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
} {
  const { id = null } = options;
  // Must run first: later preprocessors rewrite labels/fences in raw text and
  // must not see the YAML header. The header is only stripped here, never
  // rendered; callers read it with parseFrontmatter and render it themselves.
  const { content: body } = parseFrontmatter(content);
  const uuidSource = injectUuid(body, id);
  const { source: algoSource, store: algorithmStore } = preprocessAlgorithmBlocks(uuidSource);
  const { source: musicSource, store: musicStore } = preprocessMusicBlocks(algoSource);
  const { source, store } = preprocessFencedDivs(musicSource);
  return { source, store, algorithmStore, musicStore };
}

function buildRemarkPipeline(
  source: string,
  store: ReturnType<typeof preprocessFencedDivs>["store"],
  algorithmStore: ReturnType<typeof preprocessAlgorithmBlocks>["store"],
  musicStore: ReturnType<typeof preprocessMusicBlocks>["store"],
  options: ParseOptions
) {
  const { numberingDepth = 1, headingShift = 0, title, titleLevel = 1 } = options;

  let pipeline = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkFencedDivs, { store })
    .use(remarkAlgorithmBlocks, { store: algorithmStore })
    .use(remarkMusicBlocks, { store: musicStore })
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
    .use(remarkRegistryPlugin({ numberingDepth, suppressUnreferencedLabels: options.suppressUnreferencedLabels }, buildRegistry));

  return pipeline;
}

function remarkRegistryPlugin(
  opts: { numberingDepth: number; suppressUnreferencedLabels?: boolean },
  _buildRegistry: typeof buildRegistry
): Plugin<[], Root> {
  return function () {
    return (tree: Root, file: any) => {
      file.data.registry = _buildRegistry(tree, {
        numberingDepth: opts.numberingDepth,
        suppressUnreferencedLabels: opts.suppressUnreferencedLabels,
      }, String(file.value));
    };
  };
}

// ─── collectRegistry ─────────────────────────────────────────────────────────

export function collectRegistry(
  content: string,
  options: ParseOptions = {}
): NormalizedRegistry {
  const { source, store, algorithmStore, musicStore } = prepareSource(content, options);
  const processor = buildRemarkPipeline(source, store, algorithmStore, musicStore, options);
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
  const { source, store, algorithmStore, musicStore } = prepareSource(content, options);
  const processor = buildRemarkPipeline(source, store, algorithmStore, musicStore, options)
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

// ─── renderMarkdown ───────────────────────────────────────────────────────────

export function renderMarkdown(
  content: string,
  options: ParseOptions = {},
  registry?: NormalizedRegistry
): ReactElement {
  const { source, store, algorithmStore, musicStore } = prepareSource(content, options);

  const resolvedRegistry =
    registry ?? collectRegistry(content, options);

  let pipeline = buildRemarkPipeline(source, store, algorithmStore, musicStore, options)
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

  const processor = pipeline
    .use(remarkRehype, {
      allowDangerousHtml: true,
      handlers: {
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
        alertTitle: (_state: State, node: any) => ({
          type: "element",
          tagName: "p",
          properties: { className: ["alert-title"] },
          children: _state.all(node),
        }),
      },
    })
    .use(rehypeRaw)
    .use(rehypeHighlight)
    .use(rehypeReact, {
      Fragment: prod.Fragment,
      jsx: prod.jsx,
      jsxs: prod.jsxs,
      components: {
        "algorithm-pseudocode": AlgorithmPseudocode,
        "music-abc": MusicAbc,               // ← was "music-notation": MusicAbcNotation
        input: TaskCheckbox,
      },
    });

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