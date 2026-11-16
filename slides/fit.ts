/**
 * Fit testing for slide regions, shared by the off-screen measurer and the viewer so the
 * splitter's decisions match what is shown.
 *
 * A region (`.vfm-fit`) fits when its content does not overflow vertically. When a region holds
 * exactly one float (an image, score, listing, algorithm, table, theorem...) that is too tall,
 * the float is scaled down to fit rather than dropped, down to MIN_SHRINK. Text is never scaled: a
 * list or paragraph that is too tall does not fit, and the splitter moves content to the next slide,
 * so type size is the same on every slide. A float that is still too tall after shrinking does not fit either.
 */

export const MIN_SHRINK = 0.5;

/**
 * The floats that may be scaled down to fit: pictures, listings, theorem environments, algorithms, scores,
 * diagrams. Tables are not here on purpose: the splitter sizes a table's text (0.9 down to 0.6 of the text
 * around it, `slide.tableScale`, REQ-232) and divides it by rows (header repeated) when it is still too tall,
 * so a table is never scaled by a transform.
 */
const FLOAT_SELECTOR = [
  "figure",
  "pre",
  "img",
  "blockquote",
  ".labeled-figure",
  ".code-listing",
  ".theorem-env",
  ".algorithm-block",
  ".music-block",
  ".mermaid-block",
  ".alert",
  ".blockquote",
  ".equation-wrapper",
  "p:has(> img)",
  "p:has(> video)",
  "video",
].join(", ");

const overflowsY = (el: HTMLElement) => el.scrollHeight > el.clientHeight + 1;
const overflowsX = (el: HTMLElement) => el.scrollWidth > el.clientWidth + 1;

/** Returns true when the region fits, shrinking a lone float if that is what it takes. */
export function fitRegion(region: HTMLElement): boolean {
  const kids = Array.from(region.children) as HTMLElement[];
  for (const k of kids) {
    k.style.removeProperty("transform");
    k.style.removeProperty("transform-origin");
  }
  if (!overflowsY(region)) return true;
  if (kids.length !== 1) return false;
  const only = kids[0];
  if (!only.matches(FLOAT_SELECTOR)) return false; // text keeps its size
  // A transform, not `zoom`: zoom re-flows fluid-width content (a score, an image) to the wider box,
  // which cancels the shrink. A transform scales what was laid out, and counts toward scrollHeight.
  const scale = (region.clientHeight / region.scrollHeight) * 0.99;
  if (scale < MIN_SHRINK) return false;
  only.style.transformOrigin = "top center";
  only.style.transform = `scale(${scale})`;
  // scrollHeight still counts the untransformed box, so compare where the scaled float ends up.
  return only.getBoundingClientRect().bottom <= region.getBoundingClientRect().bottom + 1;
}

/** Fit test for a whole rendered slide. `twoColumns` also checks that no third column appeared. */
export function slideFits(root: ParentNode, twoColumns: boolean): boolean {
  let ok = true;
  for (const region of root.querySelectorAll<HTMLElement>(".vfm-fit")) {
    if (!fitRegion(region)) ok = false;
    if (twoColumns && overflowsX(region)) ok = false;
  }
  // A table scrolls inside its own box, so the region never sees it overflow. In a column that would clip it
  // silently; counting it as not fitting makes the splitter shrink its text or move it to the next slide (REQ-244).
  if (twoColumns) for (const table of root.querySelectorAll<HTMLElement>("table")) if (overflowsX(table)) ok = false;
  return ok;
}
