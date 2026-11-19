/**
 * headerLine.ts
 *
 * The line of a top-level key of the YAML header, so a host can jump from the rendered title, subtitle,
 * authors or date to the line that holds them (a double click in the preview).
 */

/** The 1-based line of the first of `keys` that the YAML header of `source` sets, or undefined when there is no header or no such key. */
export function headerKeyLine(source: string, keys: readonly string[]): number | undefined {
  const lines = source.replace(/^﻿/, "").split(/\r?\n/);
  if (lines[0] !== "---") return undefined;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === "---") return undefined;
    const m = /^([A-Za-z][\w-]*):/.exec(lines[i]);
    if (m && keys.includes(m[1])) return i + 1;
  }
  return undefined;
}
