/**
 * slides/referencesSlides.ts
 *
 * The References slide at the end of a deck: every reference the deck cites, in the order of the reference style,
 * at a size a person can read. A long list continues on more slides, cut between references. A deck that cites
 * nothing, or whose citations resolve to no entry, has none.
 */

import { referencesHeading, resolveCitationConfig, type CitationConfig } from "../bibliography";
import type { RefEntry, Slide, SlideBlock } from "./types";

/** The directive-less block a slide that no `@slide` wrote hangs from: it sits past the last line, so no line of the file lands on it. */
const END_OF_FILE = Number.MAX_SAFE_INTEGER;

function blank(): SlideBlock {
  return {
    kind: "slideBlock",
    id: -2,
    options: { showrefs: false, nodoc: false, noxrefs: false, steplists: false, stepleadin: false },
    headingStack: [],
    children: [],
    loc: { line: END_OF_FILE },
    endLoc: { line: END_OF_FILE },
    openLine: END_OF_FILE,
    closeLine: END_OF_FILE,
  };
}

/** `refs` in display order; `fits` says whether a candidate slide fits (the measurer of the host). */
export function referencesSlides(refs: readonly RefEntry[], config: CitationConfig, fits: (slide: Slide) => boolean): Slide[] {
  if (refs.length === 0) return [];
  const title = [{ type: "text", value: referencesHeading(resolveCitationConfig(config).referenceStyle) }] as Slide["title"];
  const make = (list: RefEntry[]): Slide => ({
    kind: "slide",
    title,
    titleSource: "none",
    continuation: { index: 1, of: 1 },
    layout: "single",
    context: [],
    body: [],
    images: [],
    references: list,
    steps: [[]],
    sourceBlock: blank(),
    labels: new Set(),
    notes: [],
    referencesSlide: true,
  });
  const chunks: RefEntry[][] = [];
  let current: RefEntry[] = [];
  for (const ref of refs) {
    current.push(ref);
    // One reference too long for a slide stays alone on its own.
    if (current.length > 1 && !fits(make(current))) {
      current.pop();
      chunks.push(current);
      current = [ref];
    }
  }
  chunks.push(current);
  return chunks.map((c, i) => ({ ...make(c), continuation: { index: i + 1, of: chunks.length } }));
}
