/**
 * constants.ts
 *
 * Constants shared by the renderer.
 */

/**
 * A section-slide background whose relative luminance (WCAG 2.x) is below this gets light text, any other dark text.
 * 0.179 is where white and the dark text color have equal contrast: (1.05 / (L + 0.05)) = ((L + 0.05) / 0.05)
 * solves to L = sqrt(1.05 * 0.05) - 0.05 ≈ 0.179 for black text; it is the usual rule for choosing a text color.
 */
export const DARK_BACKGROUND_LUMINANCE = 0.179;

/** Table text on a slide is this many times the size of the text around it... */
export const TABLE_SCALE_DEFAULT = 0.9;
/** ...and is reduced to no less than this to make a table fit. */
export const TABLE_SCALE_MIN = 0.7;
/** The reduction step. */
export const TABLE_SCALE_STEP = 0.05;
