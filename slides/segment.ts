/**
 * slides/segment.ts
 *
 * Sentence segmentation for filtering and splitting, and text-only inline
 * content for repeated context.
 *
 * A sentence ends where sentence-ending punctuation (. ! ? … 。 ！ ？, optionally followed by
 * closing quotes or brackets) is followed by a line break. Authors write one sentence per line, so
 * the segmenter needs no language-specific knowledge (no abbreviation lists, no capital-letter
 * test): "Dr. Chen" on one line is never cut, and a sentence can wrap only by not ending in a
 * terminal mark. Without line breaks a paragraph is one sentence.
 * Citations and cross-references are masked so their punctuation never counts.
 */

import type { Text } from "mdast";
import type { Inline } from "./types";
import { CITE_RE_SOURCE } from "../bibliography";
import { XREF_RE } from "./labels";

/** Blanks out spans that must never be cut, keeping offsets. */
function mask(value: string): string {
  const blank = (m: string) => "\u0000".repeat(m.length);
  return value.replace(new RegExp(CITE_RE_SOURCE, "g"), blank).replace(new RegExp(XREF_RE.source, "g"), blank);
}

const TERMINAL = "[.!?\u2026\u3002\uFF01\uFF1F]";
const CLOSERS = "[\"'\u201D\u2019)\\]\u00BB\u300D\u300F\uFF09]*";
const BOUNDARY = new RegExp(`(${TERMINAL}${CLOSERS})[ \\t]*\\r?\\n[ \\t]*`, "g");
const ENDS_SENTENCE = new RegExp(`${TERMINAL}${CLOSERS}[ \\t]*$`);

function boundaries(value: string): Array<{ cut: number; resume: number }> {
  const masked = mask(value);
  const out: Array<{ cut: number; resume: number }> = [];
  BOUNDARY.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = BOUNDARY.exec(masked)) !== null) {
    out.push({ cut: m.index + m[1].length, resume: m.index + m[0].length });
  }
  return out;
}

/** Splits a paragraph's children into sentences. Returns one entry when it cannot tell. */
export function segmentSentences(children: Inline[]): Inline[][] {
  const sentences: Inline[][] = [[]];
  const cur = () => sentences[sentences.length - 1];
  for (const child of children) {
    if (child.type === "break") {
      // A hard line break after a terminal mark ends the sentence like a newline does.
      const last = cur()[cur().length - 1];
      if (last?.type === "text" && ENDS_SENTENCE.test(mask(last.value))) sentences.push([]);
      else cur().push(child);
      continue;
    }
    if (child.type !== "text") {
      cur().push(child);
      continue;
    }
    const value = (child as Text).value;
    let from = 0;
    for (const { cut, resume } of boundaries(value)) {
      const head = value.slice(from, cut);
      if (head) cur().push({ type: "text", value: head });
      sentences.push([]);
      from = resume;
    }
    const rest = value.slice(from);
    if (rest || from === 0) cur().push({ ...(child as Text), value: rest });
  }
  return sentences.filter((s) => s.length > 0);
}

/** Text only: no citations, no cross-references, no images. */
export function plainInline(nodes: readonly Inline[]): Inline[] {
  const out: Inline[] = [];
  const clean = (s: string) =>
    s
      .replace(new RegExp(CITE_RE_SOURCE, "g"), "")
      .replace(new RegExp(XREF_RE.source, "g"), "")
      .replace(/ {2,}/g, " ");
  for (const n of nodes) {
    switch (n.type) {
      case "text": {
        const value = clean(n.value);
        if (value) out.push({ type: "text", value });
        break;
      }
      case "inlineCode":
        out.push(n);
        break;
      case "break":
        out.push({ type: "text", value: " " });
        break;
      case "image":
      case "html":
      case "footnoteReference":
      case "imageReference":
        break;
      case "emphasis":
      case "strong":
      case "delete":
        out.push({ ...n, children: plainInline(n.children as Inline[]) } as Inline);
        break;
      case "link":
      case "linkReference":
        out.push(...plainInline(n.children as Inline[]));
        break;
      default:
        out.push(n); // inlineMath, highlight and other self-contained nodes
    }
  }
  return out;
}

export function inlineText(nodes: readonly any[]): string {
  return nodes
    .map((n) => (typeof n.value === "string" ? n.value : n.children ? inlineText(n.children) : ""))
    .join("");
}
