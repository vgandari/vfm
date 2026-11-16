/**
 * slides/measure.ts
 *
 * Fit measurement. The splitter asks `fits(slide)`; the renderer answers.
 *
 * - `estimateFits` is a character-count heuristic with no DOM, used by tests,
 *   by `check` in a host without a browser, and as the default.
 * - A browser host passes its own Measurer that renders the candidate into a
 *   stage of the real slide size and tests for overflow (see the VS Code
 *   webview for one).
 */

import type { ReactElement } from "react";
import type { Block, Slide } from "./types";
import { inlineText } from "./segment";

/** Returns true when the slide fits. `render` produces the slide's React element. */
export type Measurer = (slide: Slide, render: () => ReactElement) => boolean;

/** Lines available to the content region of a 16:9 slide. */
const CAPACITY = 15;
const CHARS_PER_LINE = 78;

function lines(node: any, chars: number): number {
  switch (node.type) {
    case "paragraph":
      return Math.max(1, Math.ceil(inlineText(node.children).length / chars)) + 0.6;
    case "heading":
      return 1.8;
    case "list":
      return node.children.reduce((n: number, c: any) => n + lines(c, chars - 4), 0) + 0.3;
    case "listItem":
      return node.children.reduce((n: number, c: any) => n + lines(c, chars), 0);
    case "code":
      return String(node.value).split("\n").length * 0.9 + 1;
    case "table":
      return node.children.length * 1.5 + 1;
    case "math":
      return 3;
    case "blockquote":
    case "fencedDiv":
      return (node.children ?? []).reduce((n: number, c: any) => n + lines(c, chars - 6), 0) + 1;
    case "image":
      return 9;
    default:
      return 2;
  }
}

function imageLines(block: Block): number {
  return (block as any).children?.some((c: any) => c.type === "image") ? 10 : 2;
}

export const estimateFits: Measurer = (slide) => {
  const extra = (slide.leadin ? 2 : 0) + slide.references.length * 2;
  const room = CAPACITY - extra;
  const sum = (chars: number) => slide.body.reduce((n, b) => n + lines(b, chars), 0);
  switch (slide.layout) {
    case "2col":
      return sum(CHARS_PER_LINE / 2) <= room * 2 * 0.9;
    case "rtext":
    case "ltext":
      return sum(CHARS_PER_LINE / 2) <= room && slide.images.reduce((n, b) => n + imageLines(b), 0) <= room;
    default:
      return sum(CHARS_PER_LINE) <= room;
  }
};
