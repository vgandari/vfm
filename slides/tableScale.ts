/**
 * slides/tableScale.ts
 *
 * Sizes the text of the tables on a slide (REQ-232). Table text starts at 0.9 times the text around it and is
 * reduced in steps of 0.05 to no less than 0.6 until the slide fits. The factor is stored on the slide
 * (`tableScale`) and the stylesheet applies it.
 */

import type { Slide } from "./types";
import { TABLE_SCALE_DEFAULT, TABLE_SCALE_MIN, TABLE_SCALE_STEP } from "../constants";

export const hasTable = (slide: Slide): boolean => [...slide.body, ...slide.images].some((b) => b.type === "table");

/**
 * Sets `slide.tableScale` to the largest factor at which `fits` accepts the slide, and returns whether one did.
 * A slide without a table is only measured. When no factor fits, the factor is left at the minimum.
 */
export function fitTableScale(slide: Slide, fits: (slide: Slide) => boolean): boolean {
  if (!hasTable(slide)) return fits(slide);
  const steps = Math.round((TABLE_SCALE_DEFAULT - TABLE_SCALE_MIN) / TABLE_SCALE_STEP);
  for (let i = 0; i <= steps; i++) {
    slide.tableScale = Math.round((TABLE_SCALE_DEFAULT - i * TABLE_SCALE_STEP) * 100) / 100;
    if (fits(slide)) return true;
  }
  return false;
}
