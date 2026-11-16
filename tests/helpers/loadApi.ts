/**
 * Builds the slide API and a React server renderer once for a test file, from the sources (no build step to run first).
 * Usage: const t = loadApi(); before(t.load); after(t.cleanup); then t.api, t.ssr.
 */
import { build } from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export function loadApi() {
  const here = join(dirname(fileURLToPath(import.meta.url)), "..");
  const root = join(here, "..");
  const state: { api: any; ssr: any; cleanup: () => void } = { api: undefined, ssr: undefined, cleanup: () => {} };
  const load = async () => {
    const out = mkdtempSync(join(here, ".build-"));
    state.cleanup = () => rmSync(out, { recursive: true, force: true });
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
      stdin: { contents: 'export { renderMarkdown } from "./pipeline.ts"; export { renderSlide, renderNotes } from "./slides/index.ts"; export { renderToStaticMarkup } from "react-dom/server";', resolveDir: root, sourcefile: "ssr.ts" },
      outfile: join(out, "ssr.mjs"),
    });
    state.api = await import(pathToFileURL(join(out, "slides.mjs")).href);
    state.ssr = await import(pathToFileURL(join(out, "ssr.mjs")).href);
  };
  return { state, load, cleanup: () => state.cleanup() };
}
