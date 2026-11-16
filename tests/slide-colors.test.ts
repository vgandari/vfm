/**
 * Tests for the `slide-colors` feature: separator-color, section-color and title-image. Each test names the
 * requirements (docs/REQUIREMENTS.md) and use cases (docs/USE_CASES.md) that it verifies.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { parseThemeColor, relativeLuminance, isDarkColor } from "../slides/themeColor.ts";
import { DARK_BACKGROUND_LUMINANCE } from "../constants.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
let api: any;
let ssr: any;
let cleanup = () => {};

before(async () => {
  const out = mkdtempSync(join(here, ".build-"));
  cleanup = () => rmSync(out, { recursive: true, force: true });
  const common = {
    bundle: true,
    format: "esm" as const,
    platform: "node" as const,
    jsx: "automatic" as const,
    logLevel: "silent" as const,
    loader: { ".module.css": "local-css" as const, ".css": "empty" as const },
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
    external: ["mermaid"],
  };
  await build({ ...common, entryPoints: [join(root, "slides/index.ts")], outfile: join(out, "slides.mjs") });
  await build({
    ...common,
    stdin: { contents: 'export { renderMarkdown } from "./pipeline.ts"; export { renderToStaticMarkup } from "react-dom/server";', resolveDir: root, sourcefile: "ssr.ts" },
    outfile: join(out, "ssr.mjs"),
  });
  api = await import(pathToFileURL(join(out, "slides.mjs")).href);
  ssr = await import(pathToFileURL(join(out, "ssr.mjs")).href);
});

after(() => cleanup());

const slideHtml = (deck: any, i = 0) => ssr.renderToStaticMarkup(api.renderSlide(deck.slides[i], deck.render));
const docHtml = (md: string) => ssr.renderToStaticMarkup(ssr.renderMarkdown(md));
const css = (file: string) => readFileSync(join(root, file), "utf8");
const header = (extra = "") => `---\ntitle: T\n${extra}---\n\n`;


// ─── Separator color (UC-22) ─────────────────────────────────────────────────

// Verifies REQ-201 (UC-22)
test("separator-color sets the title rule on every slide, with no theme color and no tint", () => {
  const deck = api.buildSlideDeck(`${header('separator-color: "#e07b00"\n')}@slide[Section]\n@end\n\n@slide[Body]\nText.\n@end\n`);
  for (let i = 0; i < deck.slides.length; i++) {
    const h = slideHtml(deck, i);
    assert.match(h, /--vfm-slide-rule:#e07b00/);
    assert.doesNotMatch(h, /--vfm-slide-accent|vfm-tinted/);
  }
});

// Verifies REQ-201, REQ-202 (UC-22, UC-13)
test("separator-color and theme-color are independent; without the first the rule follows the second", () => {
  const both = api.buildSlideDeck(`${header('theme-color: "#1a6ea8"\nseparator-color: "#e07b00"\n')}@slide[Body]\nText.\n@end\n`);
  const h = slideHtml(both, 1);
  assert.match(h, /--vfm-slide-accent:#1a6ea8/);
  assert.match(h, /--vfm-slide-rule:#e07b00/);
  const themeOnly = api.buildSlideDeck(`${header('theme-color: "#1a6ea8"\n')}@slide[Body]\nText.\n@end\n`);
  assert.doesNotMatch(slideHtml(themeOnly, 1), /--vfm-slide-rule/);
  const sheet = css("slides/slides.css");
  assert.match(sheet, /\.vfm-slide-title \{[^}]*border-bottom: 3px solid var\(--vfm-slide-rule, var\(--_accent\)\)/s);
});

// ─── Section color (UC-23) ───────────────────────────────────────────────────

const sectionDeck = (extra: string) => api.buildSlideDeck(`${header(extra)}@slide[Section]\n@end\n\n@slide[Body]\nText.\n@end\n`);

// Verifies REQ-203, REQ-205 (UC-23)
test("section-color fills section slides only, as written, without a theme color", () => {
  const deck = sectionDeck('section-color: "#0b3954"\n');
  const [cover, section, body] = [0, 1, 2].map((i) => slideHtml(deck, i));
  assert.match(section, /vfm-section-colored/);
  assert.match(section, /--vfm-slide-section-bg:#0b3954/);
  assert.doesNotMatch(section, /vfm-tinted/);
  for (const h of [cover, body]) assert.doesNotMatch(h, /vfm-section-colored|--vfm-slide-section-bg|vfm-tinted/);
  const sheet = css("slides/slides.css");
  assert.match(sheet, /\.vfm-slide\.vfm-section-colored[^{]*\{[^}]*--_bg: var\(--vfm-slide-section-bg\)/s);
});

// Verifies REQ-203, REQ-204, REQ-205 (UC-23, UC-13)
test("with a theme color, section-color replaces the section tint and the title slide keeps its own", () => {
  const withBoth = sectionDeck('theme-color: "#1a6ea8"\nsection-color: "#fff3b0"\n');
  assert.doesNotMatch(slideHtml(withBoth, 1), /vfm-tinted/);
  assert.match(slideHtml(withBoth, 1), /--vfm-slide-section-bg:#fff3b0/);
  assert.match(slideHtml(withBoth, 0), /vfm-cover vfm-cover-colored/);
  assert.match(slideHtml(withBoth, 0), /--vfm-slide-cover-bg:#1a6ea8/);
  const without = sectionDeck('theme-color: "#1a6ea8"\n');
  assert.match(slideHtml(without, 1), /vfm-divider vfm-tinted/);
  assert.doesNotMatch(slideHtml(without, 1), /vfm-section-colored/);
});

// Verifies REQ-206 (UC-23)
test("text is light on a dark section color and dark on a light one, switching at relative luminance 0.179", () => {
  assert.equal(DARK_BACKGROUND_LUMINANCE, 0.179);
  assert.equal(relativeLuminance("#000000"), 0);
  assert.ok(Math.abs(relativeLuminance("#ffffff")! - 1) < 1e-9);
  assert.ok(Math.abs(relativeLuminance("#707070")! - 0.162) < 0.001);
  assert.ok(Math.abs(relativeLuminance("#777777")! - 0.184) < 0.001);
  // The forms: hex (3 and 6 digits), rgb(), hsl() and names agree.
  assert.equal(relativeLuminance("#fff"), relativeLuminance("#ffffff"));
  assert.equal(relativeLuminance("rgb(11, 57, 84)"), relativeLuminance("#0b3954"));
  assert.ok(Math.abs(relativeLuminance("hsl(0, 100%, 50%)")! - 0.2126) < 1e-3);
  assert.ok(Math.abs(relativeLuminance("hsl(120, 100%, 25%)")! - relativeLuminance("#008000")!) < 2e-3);
  assert.equal(relativeLuminance("teal"), relativeLuminance("#008080"));
  assert.equal(relativeLuminance("RebeccaPurple"), relativeLuminance("#663399"));
  for (const dark of ["#000", "#0b3954", "navy", "teal", "#707070", "hsl(210, 50%, 20%)", "darkgreen", "maroon"]) assert.equal(isDarkColor(dark), true, dark);
  for (const light of ["#fff", "#fff3b0", "yellow", "#777777", "#808080", "lightgray", "orange", "seagreen", "hsl(60, 90%, 85%)"]) assert.equal(isDarkColor(light), false, light);
  const dark = slideHtml(sectionDeck('section-color: "#0b3954"\n'), 1);
  const light = slideHtml(sectionDeck('section-color: "#fff3b0"\n'), 1);
  assert.match(dark, /vfm-on-dark/);
  assert.doesNotMatch(dark, /vfm-on-light/);
  assert.match(light, /vfm-on-light/);
  assert.doesNotMatch(light, /vfm-on-dark/);
  const sheet = css("slides/slides.css");
  assert.match(sheet, /\.vfm-slide\.vfm-on-dark[^{]*\{[^}]*--_fg: #f0f6fc/s);
  assert.match(sheet, /\.vfm-slide\.vfm-on-light[^{]*\{[^}]*--_fg: #1f2328/s);
});

// ─── Both colors ─────────────────────────────────────────────────────────────

// Verifies REQ-207 (UC-22, UC-23)
test("separator-color and section-color accept what theme-color accepts and nothing else", () => {
  for (const ok of ["#abc", "rgb(1, 2, 3)", "hsl(205, 73%, 38%)", "teal"]) {
    const deck = sectionDeck(`separator-color: "${ok}"\nsection-color: "${ok}"\n`);
    assert.match(slideHtml(deck, 1), /--vfm-slide-rule/, ok);
    assert.match(slideHtml(deck, 1), /--vfm-slide-section-bg/, ok);
  }
  const bad = sectionDeck('separator-color: "red; background: url(x)"\nsection-color: "red\\" onload=\\"x"\n');
  for (let i = 0; i < bad.slides.length; i++) assert.doesNotMatch(slideHtml(bad, i), /--vfm-slide-rule|--vfm-slide-section-bg|onload|url\(/);
});

// Verifies REQ-208 (UC-22, UC-23, UC-11)
test("an invalid separator-color or section-color is reported at its header line and the default is used", () => {
  const deck = api.buildSlideDeck(`---\ntitle: T\nseparator-color: nope\nsection-color: "#12"\n---\n\n@slide[S]\n@end\n`);
  const sep = deck.diagnostics.find((x: any) => x.code === "separator-color");
  const sec = deck.diagnostics.find((x: any) => x.code === "section-color");
  assert.equal(sep?.loc.line, 3);
  assert.equal(sec?.loc.line, 4);
  assert.equal(sep?.severity, "warning");
  assert.doesNotMatch(slideHtml(deck, 1), /--vfm-slide-rule|--vfm-slide-section-bg|vfm-section-colored/);
  const ok = sectionDeck('separator-color: red\n');
  assert.equal(ok.diagnostics.filter((d: any) => d.code === "separator-color" || d.code === "section-color").length, 0);
});

// ─── Title image (UC-24) ─────────────────────────────────────────────────────

const imageDeck = (extra = "", opts: any = {}) => api.buildSlideDeck(`${header(`title-image: images/cover.jpg\n${extra}`)}@slide[Body]\nText.\n@end\n`, opts);

// Verifies REQ-211, REQ-213 (UC-24)
test("title-image puts the image behind the title slide's text, under a scrim, in place of the tint", () => {
  const deck = imageDeck('theme-color: "#1a6ea8"\n');
  const h = slideHtml(deck, 0);
  assert.match(h, /class="vfm-slide vfm-cover vfm-cover-image"/);
  assert.match(h, /<img class="vfm-cover-bg" src="images\/cover\.jpg" alt=""\/?>/);
  assert.match(h, /<div class="vfm-cover-scrim"><\/div>/);
  assert.ok(h.indexOf("vfm-cover-bg") < h.indexOf("vfm-cover-title"));
  assert.doesNotMatch(h, /vfm-tinted/);
  assert.doesNotMatch(slideHtml(deck, 1), /vfm-cover-bg/);
  const sheet = css("slides/slides.css");
  assert.match(sheet, /\.vfm-cover-bg \{[^}]*object-fit: cover/s);
  assert.match(sheet, /\.vfm-cover-bg \{[^}]*position: absolute/s);
  assert.match(sheet, /\.vfm-cover-scrim \{[^}]*background: rgba\(0, 0, 0, 0\.5\)/s);
  assert.match(sheet, /\.vfm-slide\.vfm-cover-image[^{]*\{[^}]*--_fg: #ffffff/s);
});

// Verifies REQ-212 (UC-24)
test("title-image goes through resolveUrl, is preloaded, and cannot break out of its attribute", () => {
  const deck = imageDeck("", { resolveUrl: (u: string) => `vscode-resource:/doc/${u}` });
  assert.match(slideHtml(deck, 0), /src="vscode-resource:\/doc\/images\/cover\.jpg"/);
  assert.ok(deck.imageUrls.includes("vscode-resource:/doc/images/cover.jpg"));
  const evil = api.buildSlideDeck(`---\ntitle: T\ntitle-image: 'x" onerror="y'\n---\n\n@slide\nText.\n@end\n`);
  // The quote is escaped, so the value stays inside src and onerror never becomes an attribute.
  assert.match(slideHtml(evil, 0), /<img class="vfm-cover-bg" src="x&quot; onerror=&quot;y" alt=""\/>/);
});

// Verifies REQ-214 (UC-24, UC-11)
test("title-image without a title is reported and ignored", () => {
  const deck = api.buildSlideDeck(`---\ntitle-image: cover.jpg\n---\n\n@slide[Body]\nText.\n@end\n`);
  const d = deck.diagnostics.find((x: any) => x.code === "title-image");
  assert.equal(d?.loc.line, 2);
  assert.equal(d?.severity, "warning");
  assert.equal(deck.slides.length, 1);
  assert.deepEqual(deck.imageUrls, []);
});

// Verifies REQ-107, REQ-215 (UC-13, UC-24)
test("without title-image the title slide is the plain theme color, with text chosen by luminance", () => {
  const deck = api.buildSlideDeck(`${header('theme-color: "#1a6ea8"\n')}@slide[Body]\nText.\n@end\n`);
  const h = slideHtml(deck, 0);
  assert.match(h, /class="vfm-slide vfm-cover vfm-cover-colored vfm-on-dark"/);
  assert.match(h, /--vfm-slide-cover-bg:#1a6ea8/);
  const pale = api.buildSlideDeck(`${header('theme-color: "#fff3b0"\n')}@slide[Body]\nText.\n@end\n`);
  assert.match(slideHtml(pale, 0), /vfm-cover vfm-cover-colored vfm-on-light/);
  const sheet = css("slides/slides.css");
  assert.match(sheet, /\.vfm-slide\.vfm-cover-colored[^{]*\{[^}]*--_bg: var\(--vfm-slide-cover-bg\)/s);
  assert.doesNotMatch(h, /vfm-cover-bg|vfm-cover-scrim|vfm-cover-image/);
});
