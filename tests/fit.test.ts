/**
 * Tests for the slide measurer's fit rules (slides/fit.ts) with stand-ins for DOM elements, since layout
 * itself needs a browser (manual test MT-20 in vfm-preview).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { fitRegion, slideFits, MIN_SHRINK } from "../slides/fit";

const box = (o: Partial<Record<"scrollHeight" | "clientHeight" | "scrollWidth" | "clientWidth", number>> = {}) =>
  ({ children: [], scrollHeight: 100, clientHeight: 100, scrollWidth: 100, clientWidth: 100, style: { removeProperty() {} }, ...o }) as any;
const root = (region: any, tables: any[]) =>
  ({ querySelectorAll: (sel: string) => (sel === ".vfm-fit" ? [region] : sel === "table" ? tables : []) }) as any;

// Verifies REQ-244 (UC-26)
test("on a 2col slide a table wider than its column does not fit; elsewhere it is left alone", () => {
  const wide = box({ scrollWidth: 600, clientWidth: 500 });
  assert.equal(slideFits(root(box(), [wide]), true), false);
  assert.equal(slideFits(root(box(), [box({ scrollWidth: 500, clientWidth: 500 })]), true), true);
  assert.equal(slideFits(root(box(), [box({ scrollWidth: 501, clientWidth: 500 })]), true), true, "1 px of rounding is not overflow");
  // Single-column slides keep their old behaviour: a wide table is not a reason to move or drop it.
  assert.equal(slideFits(root(box(), [wide]), false), true);
});

/** A region holding one child: `h` is the content height, `view` the region's height; `matches` says if the child is a float. */
const lone = (h: number, view: number, float: boolean, bottom = view) => {
  const style: Record<string, string> = {};
  const child: any = {
    style: Object.assign(style, { removeProperty(k: string) { delete style[k]; } }),
    matches: () => float,
    getBoundingClientRect: () => ({ bottom: (style.transform ? bottom * 0.9 : bottom) }),
  };
  const region: any = { children: [child], scrollHeight: h, clientHeight: view, getBoundingClientRect: () => ({ bottom: view }) };
  return { region, child };
};

// Verifies REQ-011 (UC-03)
test("a lone float that is too tall is scaled down to fit, never below MIN_SHRINK", () => {
  const ok = lone(150, 100, true);
  assert.equal(fitRegion(ok.region), true);
  assert.match(ok.child.style.transform, /^scale\(0\.6/);
  const tooTall = lone(400, 100, true); // would need 0.25, below the minimum
  assert.ok(0.25 < MIN_SHRINK);
  assert.equal(fitRegion(tooTall.region), false);
  assert.equal(tooTall.child.style.transform, undefined);
});

// Verifies REQ-011 (UC-03)
test("text is never scaled: a lone non-float that is too tall does not fit, and so are several children", () => {
  const text = lone(150, 100, false);
  assert.equal(fitRegion(text.region), false);
  assert.equal(text.child.style.transform, undefined);
  const two = lone(150, 100, true);
  two.region.children.push(two.region.children[0]);
  assert.equal(fitRegion(two.region), false);
  // A region that already fits is left alone and an old transform is cleared.
  const fits = lone(90, 100, true);
  fits.child.style.transform = "scale(0.5)";
  assert.equal(fitRegion(fits.region), true);
  assert.equal(fits.child.style.transform, undefined);
});

// Verifies REQ-011 (UC-03)
test("a scaled float whose box still ends below the region does not fit", () => {
  const off = lone(150, 100, true, 200); // scaled bottom 180 > 100
  assert.equal(fitRegion(off.region), false);
});
