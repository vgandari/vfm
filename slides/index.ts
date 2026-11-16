/** Public API of the slide view. See ../README.md. */
export { buildSlideDeck, checkSlides } from "./deck";
export type { SlideDeck, SlideDeckOptions } from "./deck";
export { renderSlide, renderNotes } from "./render";
export type { SlideRenderContext } from "./render";
export { estimateFits } from "./measure";
export type { Measurer } from "./measure";
export { createDomMeasurer } from "./domMeasurer";
export { slideFits, fitRegion } from "./fit";
export { expandIncludes } from "./includes";
export type { ExpandedSource, IncludeOptions } from "./includes";
export { SlideDirectiveError } from "./types";
export type {
  Diagnostic,
  DiagnosticCode,
  Severity,
  SourceLoc,
  Slide,
  SlideBlock,
  ContextItem,
  Layout,
  SlideOptionFlags,
} from "./types";
