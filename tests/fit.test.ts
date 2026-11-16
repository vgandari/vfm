/**
 * Tests for the slide measurer's fit rules (slides/fit.ts) with stand-ins for DOM elements, since layout
 * itself needs a browser (manual test MT-20 in vfm-preview).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { slideFits } from "../slides/fit";

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
