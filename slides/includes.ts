/**
 * slides/includes.ts
 *
 * `@include(path)` textual substitution on raw source, before anything else.
 *
 *   @include(chapters/intro.md)
 *
 * The directive sits on its own line outside code fences. Paths are relative to
 * the including file. Includes nest, and a cycle is a syntax error. The result
 * carries a line map so every later diagnostic can name the original file.
 */

import { parseFrontmatter } from "../frontmatter";
import type { Diagnostic, SourceLoc } from "./types";

export interface IncludeOptions {
  /** Name of the main document, used as the base for relative paths. */
  file: string;
  /** Returns the text of `path` (already resolved against the including file), or null. */
  read: (path: string) => string | null;
  /** Joins an including file's path with a relative include path. Default: POSIX-style. */
  resolve?: (from: string, relative: string) => string;
  maxDepth?: number;
}

export interface ExpandedSource {
  text: string;
  /** One entry per line of `text`: where that line came from. `file` is absent for the main document. */
  lineMap: SourceLoc[];
  diagnostics: Diagnostic[];
}

const INCLUDE_RE = /^@include\(([^)]*)\)\s*$/;
const FENCE_RE = /^( {0,3})(```+|~~~+)/;

function posixResolve(from: string, relative: string): string {
  if (relative.startsWith("/")) return relative;
  const parts = from.split("/").slice(0, -1);
  for (const seg of relative.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return parts.join("/");
}

export function expandIncludes(source: string, options: IncludeOptions): ExpandedSource {
  const resolve = options.resolve ?? posixResolve;
  const maxDepth = options.maxDepth ?? 32;
  const diagnostics: Diagnostic[] = [];
  const out: string[] = [];
  const lineMap: SourceLoc[] = [];

  // Front matter belongs to the main document and is never searched.
  let body = source;
  let prefix = "";
  try {
    const { content } = parseFrontmatter(source);
    prefix = source.slice(0, source.length - content.length);
    body = content;
  } catch {
    // A broken header is reported by whoever renders it.
  }
  if (prefix) {
    const prefixLines = prefix.split("\n");
    prefixLines.pop(); // text after the last newline starts the body
    prefixLines.forEach((l, i) => {
      out.push(l);
      lineMap.push({ line: i + 1 });
    });
  }
  const lineBase = out.length;

  const walk = (text: string, file: string, isMain: boolean, stack: string[], baseLine: number) => {
    const lines = text.split("\n");
    let fence: { ch: string; len: number } | null = null;
    lines.forEach((line, i) => {
      const loc: SourceLoc = isMain ? { line: baseLine + i + 1 } : { file, line: i + 1 };
      const fm = FENCE_RE.exec(line);
      if (fm) {
        const ch = fm[2][0];
        const len = fm[2].length;
        if (!fence) fence = { ch, len };
        else if (ch === fence.ch && len >= fence.len) fence = null;
      }
      const m = fence ? null : INCLUDE_RE.exec(line);
      if (!m) {
        out.push(line);
        lineMap.push(loc);
        return;
      }
      const target = resolve(file, m[1].trim());
      const fail = (message: string) => {
        diagnostics.push({ code: "syntax", severity: "error", message, loc });
        out.push("");
        lineMap.push(loc);
      };
      if (!m[1].trim()) return fail("@include needs a path");
      if (stack.includes(target) || target === file) {
        return fail(`@include cycle: ${[...stack, file, target].join(" → ")}`);
      }
      if (stack.length + 1 > maxDepth) return fail("@include nested too deeply");
      const included = options.read(target);
      if (included === null) return fail(`cannot read included file "${target}"`);
      walk(included.replace(/\r\n/g, "\n").replace(/\n$/, ""), target, false, [...stack, file], 0);
    });
  };

  walk(body.replace(/\r\n/g, "\n"), options.file, true, [], lineBase);
  return { text: out.join("\n"), lineMap, diagnostics };
}
