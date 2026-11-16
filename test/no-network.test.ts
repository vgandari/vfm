import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (name === "node_modules" || name === "test" || name.startsWith(".")) return [];
    return statSync(p).isDirectory() ? sources(p) : /\.(tsx?|css)$/.test(name) ? [p] : [];
  });
}

// The one module that talks to a server: it posts entries the user added (see README).
const ALLOWED = new Set(["bibliography-client.ts"]);

test("vfm sources never reach the network", () => {
  const bad: string[] = [];
  for (const file of sources(root)) {
    const rel = relative(root, file);
    if (ALLOWED.has(rel)) continue;
    const text = readFileSync(file, "utf8");
    const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    for (const re of [/\bfetch\s*\(/, /XMLHttpRequest/, /\bWebSocket\b/, /sendBeacon/, /EventSource/, /@import\s+url\(\s*['"]?https?:/, /url\(\s*['"]?https?:\/\//, /<script[^>]+src=/, /importScripts/]) {
      if (re.test(code)) bad.push(`${rel}: ${re}`);
    }
  }
  assert.deepEqual(bad, []);
});

test("Mermaid is configured so it cannot fetch", () => {
  const src = readFileSync(join(root, "MermaidDiagram.tsx"), "utf8");
  assert.match(src, /securityLevel:\s*"strict"/);
  assert.doesNotMatch(src, /registerIconPacks|iconify/i);
});
