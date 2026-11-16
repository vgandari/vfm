/**
 * Test-only helpers for the slides tutorial: finds the example decks, reads them the way a host does (with `@include`
 * expanded and the tutorial's bibliography), and summarizes a built deck as plain data that a test can compare.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseBibTeX } from "../../bibtex.ts";

const here = dirname(fileURLToPath(import.meta.url));
export const tutorialDir = join(here, "../../docs/tutorial");
export const decksDir = join(tutorialDir, "slides");

/** File names of the example decks in `docs/tutorial/slides/`, in order. */
export const deckFiles = (): string[] => readdirSync(decksDir).filter((f) => /^\d\d-.*\.md$/.test(f)).sort();

/** The bibliography file the decks name, as the map `buildSlideDeck` takes. */
export const tutorialBibliography = () =>
  new Map(parseBibTeX(readFileSync(join(tutorialDir, "tutorial.bib"), "utf8")).entries.map((e: any) => [e.citeKey, e]));

export interface DeckSource {
  text: string;
  sourceMap: unknown[];
  file: string;
}

/** A deck's text with `@include`s expanded, and the map from its lines back to files. `api` is the bundled slide API. */
export function readDeck(api: any, name: string): DeckSource {
  const file = join(decksDir, name);
  const read = (p: string) => {
    try {
      return readFileSync(p, "utf8");
    } catch {
      return null;
    }
  };
  const expanded = api.expandIncludes(read(file), { file, read });
  return { text: expanded.text, sourceMap: expanded.lineMap, file };
}

const textOf = (n: any): string => (typeof n.value === "string" ? n.value : (n.children ?? []).map(textOf).join(""));

export interface SlideSummary {
  cover: boolean;
  title: string;
  titleSource: string;
  layout: string;
  part: string;
  body: string[];
  images: number;
  steps: number;
  references: number;
  notes: number;
  leadin: boolean;
}

/** What a reader would check about each slide of a deck: its title, layout, content kinds, steps, notes. */
export function summarize(deck: any): SlideSummary[] {
  return deck.slides.map((s: any) => ({
    cover: !!s.cover,
    title: (s.title ?? []).map(textOf).join(""),
    titleSource: s.titleSource,
    layout: s.layout,
    part: `${s.continuation.index}/${s.continuation.of}`,
    body: s.body.map((b: any) => b.type),
    images: s.images.length,
    steps: s.steps.length,
    references: s.references.length,
    notes: (s.notes ?? []).length,
    leadin: !!s.leadin,
  }));
}
