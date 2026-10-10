"use client";

import { useMemo, useEffect, useRef, useState } from "react";
import { renderMarkdown, collectRegistry, collectCitations, type ParseOptions } from "./pipeline";
import { resolveBibliography, createFetchResolver, type BibResolver, type BibliographyMap, type CitationConfig } from "./bibliography";
import { NormalizedRegistry } from "./registry";
import { useMarkdownRegistry } from "./RegistryContext";
import StaticMarkdownRenderer from "./StaticMarkdownRenderer";
import styles from "./CustomMarkdown.module.css";

interface MarkdownRendererProps {
  content: string;
  numberingDepth?: number;
  headingShift?: number;
  id?: string | null;
  registry?: NormalizedRegistry;
  title?: string;
  titleLevel?: number;
  suppressUnreferencedLabels?: boolean;
  /**
   * Looks up `@cite(key)` entries in the browser. Defaults to fetching
   * `GET /api/bib/<key>`; pass createFetchResolver("/other") for another
   * endpoint, or `false` to leave `@cite(...)` as literal text. Only the first
   * value is used for the lifetime of the component, so it need not be memoized.
   */
  bibliography?: BibResolver | false;
  /** Reference style, citation style and sort order. Defaults to APA. */
  citations?: CitationConfig;
  /**
   * Class for the wrapping <div>. When given, the host site's CSS styles the
   * output and the bundled default stylesheet is not applied. See README.
   */
  className?: string;
}

// Shared by every renderer on the page, so each key is fetched once.
const defaultBibResolver = createFetchResolver("/api/bib");

function isNonEmpty(r: NormalizedRegistry | null | undefined): r is NormalizedRegistry {
  return !!r && !r.keys().next().done;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function resolveOptions(
  props: Pick<
    MarkdownRendererProps,
    "numberingDepth" | "headingShift" | "id" | "title" | "titleLevel" | "suppressUnreferencedLabels"
  >
): ParseOptions {
  const {
    numberingDepth = 1,
    headingShift = 0,
    id = null,
    title,
    titleLevel = 1,
    suppressUnreferencedLabels = false,
  } = props;

  // 0 disables heading numbering.
  const effectiveNumberingDepth = Math.max(0, numberingDepth);

  if (title) {
    const effectiveTitleLevel = clamp(titleLevel, 1, 5);
    const effectiveHeadingShift = clamp(
      Math.max(headingShift, effectiveTitleLevel + 1),
      effectiveTitleLevel + 1,
      6
    );
    return {
      numberingDepth: effectiveNumberingDepth,
      headingShift: effectiveHeadingShift,
      id,
      title,
      titleLevel: effectiveTitleLevel,
      suppressUnreferencedLabels,
    };
  }

  return {
    numberingDepth: effectiveNumberingDepth,
    headingShift: clamp(headingShift, 0, 6),
    id,
    suppressUnreferencedLabels,
  };
}

export function MarkdownRenderer({
  content,
  numberingDepth = 1,
  headingShift = 0,
  id = null,
  registry: registryProp,
  title,
  titleLevel = 1,
  suppressUnreferencedLabels = false,
  bibliography,
  citations,
  className,
}: MarkdownRendererProps) {
  const options = resolveOptions({
    numberingDepth,
    headingShift,
    id,
    title,
    titleLevel,
    suppressUnreferencedLabels,
  });

  const ctx = useMarkdownRegistry();

  const ownRegistry = useMemo(() => {
    if (!content) return null;
    try {
      return collectRegistry(content, options);
    } catch (err) {
      console.error("MarkdownRenderer: failed to collect registry", err);
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, options.numberingDepth, options.headingShift, id, title, titleLevel]);

  useEffect(() => {
    if (!ctx || !id || !ownRegistry) return;
    ctx.registerEntries(id, ownRegistry);
    return () => ctx.unregisterEntries(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, ownRegistry]);

  const ctxRegistry = ctx?.registry ?? null;

  const resolvedRegistry =
    registryProp ??
    (isNonEmpty(ctxRegistry) ? ctxRegistry : null) ??
    ownRegistry ??
    undefined;

  // ── Citations ──────────────────────────────────────────────────────────────
  // Entries arrive asynchronously. Until they do, citations render as "(…)".
  const resolverRef = useRef(bibliography === undefined ? defaultBibResolver : bibliography || undefined);
  const citeKeys = useMemo(() => {
    if (!content || !resolverRef.current) return [];
    try {
      return collectCitations(content);
    } catch (err) {
      console.error("MarkdownRenderer: failed to collect citations", err);
      return [];
    }
  }, [content]);
  const citeSignature = citeKeys.join("\n");

  const [resolved, setResolved] = useState<{ signature: string; entries: BibliographyMap } | null>(null);

  useEffect(() => {
    const resolver = resolverRef.current;
    if (!resolver || citeKeys.length === 0) return;
    let cancelled = false;
    resolveBibliography(citeKeys, resolver).then((entries) => {
      if (!cancelled) setResolved({ signature: citeSignature, entries });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [citeSignature]);

  const bibliographyEntries =
    citeKeys.length > 0 && resolved?.signature === citeSignature ? resolved.entries : undefined;
  const bibliographyPending = citeKeys.length > 0 && !bibliographyEntries;

  const rendered = useMemo(() => {
    if (!content) return null;
    try {
      return renderMarkdown(
        content,
        { ...options, bibliography: bibliographyEntries, bibliographyPending, citations },
        resolvedRegistry
      );
    } catch (err) {
      console.error("MarkdownRenderer: failed to render content", err);
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, options.numberingDepth, options.headingShift, id, title, titleLevel, suppressUnreferencedLabels, ctxRegistry, ownRegistry, bibliographyEntries, bibliographyPending, citations?.referenceStyle, citations?.citationStyle, citations?.sort]);

  return (
    <div id={id ?? undefined} className={className ?? styles.markdownBody}>
      {rendered}
    </div>
  );
}

export { StaticMarkdownRenderer };