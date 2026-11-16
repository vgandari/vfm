/**
 * slides/types.ts
 *
 * Types for slide directives (see ../../slide-directives-spec.md).
 *
 * The parser produces SlideBlock containers; the slide builder turns them
 * into Slide nodes, one per rendered slide.
 */

import type { PhrasingContent, RootContent } from "mdast";
import type { FormattedReference } from "../bibliography";

export type Inline = PhrasingContent;
export type Block = RootContent;

/** A place in the author's files. `file` is absent for the main document. */
export interface SourceLoc {
  file?: string;
  line: number;
  column?: number;
}

export type Severity = "error" | "warning" | "info";

export type DiagnosticCode =
  | "syntax"
  | "unknown-label"
  | "unknown-footnote"
  | "doc-ref-into-nodoc"
  | "overflow"
  | "drop-float"
  | "table-split"
  | "bibliography"
  | "drop-xref"
  | "drop-follows"
  | "drop-all"
  | "xref-in-table-or-code"
  | "split"
  | "paragraph-split"
  | "paragraph-mode"
  | "too-many-headings"
  | "heading-stranded"
  | "layout-ignored"
  | "leadin-dropped"
  | "layout-no-image"
  | "step-noop"
  | "theme-color";

export interface Diagnostic {
  code: DiagnosticCode;
  severity: Severity;
  message: string;
  loc?: SourceLoc;
}

/** Thrown when a document has fatal slide-directive errors (in either mode). */
export class SlideDirectiveError extends Error {
  readonly diagnostics: Diagnostic[];
  constructor(diagnostics: Diagnostic[]) {
    const errors = diagnostics.filter((d) => d.severity === "error");
    super(
      errors
        .map((d) => `${d.loc ? `line ${d.loc.line}${d.loc.file ? ` of ${d.loc.file}` : ""}: ` : ""}${d.message} [${d.code}]`)
        .join("\n")
    );
    this.name = "SlideDirectiveError";
    this.diagnostics = diagnostics;
  }
}

export type Layout = "rtext" | "ltext" | "2col";

export interface SlideOptionFlags {
  layout?: Layout;
  showrefs: boolean;
  nodoc: boolean;
  noxrefs: boolean;
  steplists: boolean;
  stepleadin: boolean;
}

export interface HeadingRef {
  depth: number;
  inline: Inline[];
  label?: string | null;
  loc: SourceLoc;
  /** 1-based line in the text the parser saw (after `@include` expansion); what `data-line` carries. */
  line: number;
}

/** Parser output: a transparent container in document mode. */
export interface SlideBlock {
  kind: "slideBlock";
  /** Position in source order. */
  id: number;
  title?: Inline[];
  leadin?: Inline[];
  options: SlideOptionFlags;
  /** The nearest heading in effect where the opener sits. */
  headingInEffect?: HeadingRef;
  /** Every heading in effect at the opener, indexed by depth - 1 (undefined = none). */
  headingStack: (HeadingRef | undefined)[];
  children: Block[];
  loc: SourceLoc;
  endLoc: SourceLoc;
  /** Lines of the `@slide` and `@end` directives in the text the parser saw (see HeadingRef.line). */
  openLine: number;
  closeLine: number;
}

export interface ContextItem {
  kind: "listParent" | "heading";
  /** Text only: no @cite, no cross-references. */
  inline: Inline[];
  continued: boolean;
}

export type RefEntry = FormattedReference;

/** Slide builder output: one per rendered slide. */
export interface Slide {
  kind: "slide";
  title: Inline[];
  titleSource: "override" | "heading" | "none";
  /** Line (in the parsed text) the title came from: the `@slide[...]` opener or the heading. Absent for none. */
  titleLine?: number;
  continuation: { index: number; of: number };
  layout: "single" | "rtext" | "ltext" | "2col";
  context: ContextItem[];
  body: Block[];
  images: Block[];
  /** Only references not shown by an earlier slide, under showrefs. */
  references: RefEntry[];
  leadin?: Inline[];
  /** Line of the `@end(...)` that holds the lead-in. */
  leadinLine?: number;
  /** steps[0] is empty; steps[k] holds the ids of what appears at step k. */
  steps: string[][];
  /** Step at which the lead-in appears, under stepleadin. */
  leadinStep?: number;
  sourceBlock: SlideBlock;
  /** The title slide made from the YAML header. */
  cover?: {
    title: string;
    subtitle?: string;
    authors: Array<{ name: string; affiliations: number[] }>;
    affiliations: string[];
    /** False when the affiliations are listed without numbers (one shared affiliation, or none tied to an author). */
    numbered: boolean;
    date?: string;
  };
  /** Presenter notes: the `@note(...)` blocks after this slide's content and before the next slide's. */
  notes: Inline[][];
  /** True for a divider or merged agenda: body holds a list (or one heading). */
  divider?: boolean;
  /** Labels defined on this slide (for per-slide cross-reference resolution). */
  labels: Set<string>;
}
