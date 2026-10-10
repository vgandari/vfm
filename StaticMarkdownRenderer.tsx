import { renderMarkdown, collectRegistry, collectCitations, type ParseOptions } from "./pipeline";
import { resolveBibliography, type BibResolver, type CitationConfig } from "./bibliography";
import styles from "./CustomMarkdown.module.css";

interface StaticMarkdownRendererProps {
    content: string;
    /** Heading depth for number prefixes; 0 disables heading numbering. */
    numberingDepth?: number;
    /**
     * Class for the wrapping <div>. When given, the host site's CSS styles the
     * output and the bundled default stylesheet is not applied. See README.
     */
    className?: string;
    /**
     * Looks up `@cite(key)` entries at render (build) time. Omit it and
     * `@cite(...)` stays literal text. This makes the component async, so it
     * can only be rendered by a server component.
     */
    bibliography?: BibResolver;
    /** Reference style, citation style and sort order. Defaults to APA. */
    citations?: CitationConfig;
}

export default async function StaticMarkdownRenderer({
    content,
    numberingDepth = 1,
    className,
    bibliography,
    citations,
}: StaticMarkdownRendererProps) {
    const headingShift = 0;
    const id = null;
    const suppressUnreferencedLabels = true;
    const options: ParseOptions = { numberingDepth, headingShift, id, suppressUnreferencedLabels };

    const ownRegistry = content ? collectRegistry(content, options) : null;
    // KLUDGE:
    const resolvedRegistry = ownRegistry ?? undefined;

    const bibliographyEntries =
        content && bibliography
            ? await resolveBibliography(collectCitations(content, options), bibliography)
            : undefined;

    const rendered = content
        ? renderMarkdown(content, { ...options, bibliography: bibliographyEntries, citations }, resolvedRegistry)
        : null;

    return (
        <div id={id ?? undefined} className={className ?? styles.markdownBody}>
            {rendered}
        </div>
    );
}
