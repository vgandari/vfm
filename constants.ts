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
