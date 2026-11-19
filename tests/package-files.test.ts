/**
 * Tests for the package's `files` list: a project that installs vfm from GitHub gets only the listed files, so every
 * relative import of a listed source file shall lead to a listed file. Requirements: docs/REQUIREMENTS.md.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Every file that `npm install` ships, relative to the package root: each entry of `files`, with folders expanded. */
function shipped(): Set<string> {
  const listed: string[] = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).files;
  const out = new Set<string>();
  const add = (path: string) => {
    if (statSync(join(root, path)).isDirectory()) readdirSync(join(root, path)).forEach((f) => add(join(path, f)));
    else out.add(normalize(path));
  };
  listed.forEach(add);
  return out;
}

/** The import specifiers of a source file that start with `.`, ignoring those inside comments. */
function relativeImports(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  return [...code.matchAll(/(?:\bfrom|\bimport)\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/g)].map((m) => m[1]);
}

// Verifies REQ-334 (UC-58)
test("every file in the package's files list exists", () => {
  const listed: string[] = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).files;
  assert.deepEqual(listed.filter((f) => !existsSync(join(root, f))), []);
});

// Verifies REQ-334 (UC-58)
test("every relative import of a shipped source file leads to a shipped file", () => {
  const files = shipped();
  const candidates = (target: string) => ["", ".ts", ".tsx", ".css", "/index.ts", "/index.tsx"].map((e) => normalize(target + e));
  const missing: string[] = [];
  for (const file of files) {
    if (!/\.tsx?$/.test(file)) continue;
    for (const spec of relativeImports(readFileSync(join(root, file), "utf8"))) {
      const target = join(dirname(file), spec);
      if (!candidates(target).some((c) => files.has(c))) missing.push(`${file} imports ${spec}`);
    }
  }
  assert.deepEqual(missing, [], "add these files to \"files\" in package.json");
});
