/**
 * plugins/lang-fences.ts
 *
 * Shared raw-source pass for blocks written as ordinary fenced code with a
 * reserved language: ```alg, ```mus and ```mermaid.
 *
 *   ```alg Optional caption text {#alg:label}
 *   ...body, passed through verbatim...
 *   ```
 *
 * The opening line is a fence (``` or ~~~, up to three spaces of indent), the
 * language word, then an optional caption and a trailing {#label}. The block
 * closes at a fence of the same character and at least the same length, so a
 * body that itself holds ``` lines can be wrapped in a longer fence.
 *
 * Each block is replaced by a placeholder fence of the SAME NUMBER OF LINES,
 * so line numbers in the parsed tree still match the author's file (the
 * preview uses them for scroll sync and jump-to-source).
 */

export interface LangFenceBlock {
  /** Text after the language word on the opening line. */
  info: string;
  /** The lines between the fences, verbatim. */
  body: string;
}

const FENCE_OPEN = /^( {0,3})(`{3,}|~{3,})(.*)$/;

export function extractLangFences(
  rawSource: string,
  lang: string,
  placeholder: (id: number) => string,
  onBlock: (id: number, block: LangFenceBlock) => void
): string {
  const lines = rawSource.split("\n");
  const out: string[] = [];
  let id = 0;
  let i = 0;
  // A fence of some other language: pass its body through untouched.
  let other: { ch: string; len: number } | null = null;

  while (i < lines.length) {
    const line = lines[i];
    const m = FENCE_OPEN.exec(line);
    if (other) {
      if (m && m[2][0] === other.ch && m[2].length >= other.len && !m[3].trim()) other = null;
      out.push(line);
      i++;
      continue;
    }
    if (!m) {
      out.push(line);
      i++;
      continue;
    }
    const ch = m[2][0];
    const len = m[2].length;
    const info = m[3].trim();
    const word = /^[^\s{]*/.exec(info)?.[0].toLowerCase() ?? "";
    // A backtick fence's info string cannot contain a backtick (that would be inline code).
    if (word !== lang || (ch === "`" && m[3].includes("`"))) {
      other = { ch, len };
      out.push(line);
      i++;
      continue;
    }

    const start = i;
    const body: string[] = [];
    i++;
    let closed = false;
    while (i < lines.length) {
      const c = FENCE_OPEN.exec(lines[i]);
      if (c && c[2][0] === ch && c[2].length >= len && !c[3].trim()) {
        closed = true;
        break;
      }
      body.push(lines[i]);
      i++;
    }
    if (closed) i++;
    const used = i - start;

    onBlock(id, { info: info.slice(word.length).trim(), body: body.join("\n") });
    out.push("```" + placeholder(id));
    for (let k = 1; k < used - (closed ? 1 : 0); k++) out.push("");
    if (closed) out.push("```");
    id++;
  }
  return out.join("\n");
}
