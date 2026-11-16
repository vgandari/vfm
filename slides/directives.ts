/**
 * slides/directives.ts
 *
 * `@slide` / `@end` directives, in two phases like the other block syntaxes.
 *
 * Phase 1 (preprocessor, raw source): scan lines outside code fences, validate
 * each directive, and replace it, in place, with a one-line HTML comment
 * marker. Line numbers never change, so positions stay exact.
 *
 *   @slide[Title](rtext, showrefs)   →   <!--vfm:slide:0-->
 *   @end(lead-in)                    →   <!--vfm:end:0-->
 *
 * Phase 2 (remark plugin, after parsing): find the markers among the root's
 * children and group what lies between them into SlideBlock containers.
 *   - "document" mode: markers disappear, blocks are transparent, and `nodoc`
 *     blocks are removed.
 *   - "analyze" mode (slide view): markers disappear and the full tree stays;
 *     the blocks are recorded in file.data.slideBlocks for the slide builder.
 *
 * Wrappers only contain whole top-level blocks; a marker anywhere else is a
 * syntax error.
 */

import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkUnderline from "../plugins/underline";
import remarkMath from "remark-math";
import { visit } from "unist-util-visit";
import type { Plugin } from "unified";
import type { Root, RootContent, Heading } from "mdast";
import { CITE_RE_SOURCE } from "../bibliography";
import { labelsOf } from "./labels";
import type {
  Block,
  Diagnostic,
  HeadingRef,
  Inline,
  Layout,
  SlideBlock,
  SlideOptionFlags,
  SourceLoc,
} from "./types";
import { SlideDirectiveError } from "./types";

const LAYOUTS: readonly Layout[] = ["rtext", "ltext", "2col"];
const FLAGS = ["showrefs", "nodoc", "noxrefs", "steplists", "stepleadin"] as const;

export type Locator = (line: number) => SourceLoc;

interface Opener {
  line: number;
  titleSource?: string;
  options: SlideOptionFlags;
}
interface Closer {
  line: number;
  leadinSource?: string;
}
interface NoteSource {
  line: number;
  source: string;
}

/** What the preprocessor found; handed to the remark plugin. */
export interface DirectiveStore {
  openers: Opener[];
  closers: Closer[];
  notes: NoteSource[];
  diagnostics: Diagnostic[];
  locate: Locator;
}

const ANY_DIRECTIVE = /^((?:\s*(?:>\s*|[-*+]\s+|\d+[.)]\s+))*\s*)@(slide|end|note)(?![A-Za-z0-9_-])(.*)$/;
const FENCE_RE = /^( {0,3})(```+|~~~+)/;

function emptyOptions(): SlideOptionFlags {
  return { showrefs: false, nodoc: false, noxrefs: false, steplists: false, stepleadin: false };
}

/** Reads `[title]` starting at rest[0] === "[". `\]` escapes a bracket. */
function readTitle(rest: string): { value: string; end: number } | null {
  let value = "";
  for (let i = 1; i < rest.length; i++) {
    const c = rest[i];
    if (c === "\\" && (rest[i + 1] === "]" || rest[i + 1] === "\\")) {
      value += rest[i + 1];
      i++;
    } else if (c === "]") {
      return { value, end: i + 1 };
    } else {
      value += c;
    }
  }
  return null;
}

/** Reads `(text)` with balanced parentheses; `\)` is a literal parenthesis. */
function readParens(rest: string): { value: string; end: number } | null {
  let value = "";
  let depth = 0;
  for (let i = 0; i < rest.length; i++) {
    const c = rest[i];
    if (c === "\\" && rest[i + 1] === ")") {
      value += ")";
      i++;
    } else if (c === "(") {
      if (depth > 0) value += c;
      depth++;
    } else if (c === ")") {
      depth--;
      if (depth === 0) return { value, end: i + 1 };
      value += c;
    } else {
      value += c;
    }
  }
  return null;
}

function parseOptions(list: string): SlideOptionFlags | string {
  const options = emptyOptions();
  if (!list.trim()) return options;
  for (const raw of list.split(",")) {
    const name = raw.trim();
    if (!name) return "empty option in the option list";
    if ((LAYOUTS as readonly string[]).includes(name)) {
      if (options.layout) return `only one layout is allowed, got "${options.layout}" and "${name}"`;
      options.layout = name as Layout;
    } else if ((FLAGS as readonly string[]).includes(name)) {
      const flag = name as (typeof FLAGS)[number];
      if (options[flag]) return `option "${name}" given twice`;
      options[flag] = true;
    } else {
      return `unknown option "${name}"`;
    }
  }
  return options;
}

export function markerFor(kind: "slide" | "end" | "note", id: number): string {
  return `<!--vfm:${kind}:${id}-->`;
}
const MARKER_RE = /^<!--vfm:(slide|end|note):(\d+)-->$/;

export function parseMarker(value: string): { kind: "slide" | "end" | "note"; id: number } | null {
  const m = MARKER_RE.exec(value.trim());
  return m ? { kind: m[1] as "slide" | "end" | "note", id: Number(m[2]) } : null;
}

export function preprocessSlideDirectives(
  rawSource: string,
  locate: Locator = (line) => ({ line })
): { source: string; store: DirectiveStore } {
  const store: DirectiveStore = { openers: [], closers: [], notes: [], diagnostics: [], locate };
  const lines = rawSource.split("\n");
  const out: string[] = [];
  let fence: { ch: string; len: number } | null = null;
  let open = false;
  let openLine = 0;

  const error = (line: number, message: string) =>
    store.diagnostics.push({ code: "syntax", severity: "error", message, loc: locate(line) });
  const citeRe = new RegExp(CITE_RE_SOURCE);
  const noteRe = /\[\^[^\]]+\]/;

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    const lineNo = idx + 1;
    const fm = FENCE_RE.exec(line.replace(/^(>\s*)+/, ""));
    if (fm) {
      const ch = fm[2][0];
      const len = fm[2].length;
      if (!fence) fence = { ch, len };
      else if (ch === fence.ch && len >= fence.len) fence = null;
      out.push(line);
      continue;
    }
    if (fence) {
      out.push(line);
      continue;
    }
    const m = ANY_DIRECTIVE.exec(line);
    if (!m) {
      out.push(line);
      continue;
    }
    const [, prefix, kind, rest] = m;
    if (prefix.length > 0) {
      error(lineNo, `@${kind} must start at the beginning of its own line`);
      out.push("");
      continue;
    }

    if (kind === "note") {
      if (!open) {
        // Outside a @slide block it is not a directive: ordinary text, left exactly as written.
        out.push(line);
        continue;
      }
      // A note may run over several lines: read until its parentheses balance.
      let text = rest;
      let last = idx;
      let parsed = rest.startsWith("(") ? readParens(text) : null;
      while (rest.startsWith("(") && !parsed && last + 1 < lines.length && last - idx < 200) {
        text += "\n" + lines[++last];
        parsed = readParens(text);
      }
      if (!rest.startsWith("(")) {
        error(lineNo, "@note needs its text in parentheses: @note(text)");
        out.push("");
        continue;
      }
      if (!parsed) {
        error(lineNo, "unbalanced parentheses in @note(...); write a literal one as \\)");
        out.push("");
        continue;
      }
      if (text.slice(parsed.end).trim()) {
        error(lineNo, `unexpected text after @note: "${text.slice(parsed.end).trim()}"`);
        out.push("");
        continue;
      }
      const id = store.notes.length;
      store.notes.push({ line: lineNo, source: parsed.value });
      out.push(markerFor("note", id));
      // Keep line numbers: the lines a long note used are blanked.
      for (let k = idx + 1; k <= last; k++) out.push("");
      idx = last;
      continue;
    }

    if (kind === "slide") {
      const opener: Opener = { line: lineNo, options: emptyOptions() };
      let tail = rest;
      let ok = true;
      if (/^\s+[[(]/.test(tail)) {
        error(lineNo, "no space is allowed between @slide and its [title] or (options)");
        ok = false;
      } else {
        if (tail.startsWith("[")) {
          const t = readTitle(tail);
          if (!t) {
            error(lineNo, "unterminated [title]; write a literal bracket as \\]");
            ok = false;
          } else {
            opener.titleSource = t.value;
            tail = tail.slice(t.end);
            if (citeRe.test(t.value)) {
              error(lineNo, "@cite is not allowed in a slide title");
              ok = false;
            } else if (noteRe.test(t.value)) {
              error(lineNo, "footnote references are not allowed in a slide title; put them in the slide body");
              ok = false;
            }
          }
        }
        if (ok && tail.startsWith("(")) {
          const p = readParens(tail);
          if (!p) {
            error(lineNo, "unbalanced parentheses in the option list");
            ok = false;
          } else {
            const parsed = parseOptions(p.value);
            if (typeof parsed === "string") {
              error(lineNo, parsed);
              ok = false;
            } else {
              opener.options = parsed;
            }
            tail = tail.slice(p.end);
          }
        }
        if (ok && tail.trim()) {
          error(lineNo, `unexpected text after @slide: "${tail.trim()}"`);
          ok = false;
        }
      }
      if (!ok) {
        out.push("");
        continue;
      }
      if (open) {
        error(lineNo, "@slide blocks cannot nest; close the previous one with @end");
        out.push("");
        continue;
      }
      const id = store.openers.length;
      store.openers.push(opener);
      open = true;
      openLine = lineNo;
      out.push(markerFor("slide", id));
      continue;
    }

    // @end
    const closer: Closer = { line: lineNo };
    let ok = true;
    if (rest.startsWith("(")) {
      const p = readParens(rest);
      if (!p) {
        error(lineNo, "unbalanced parentheses in @end(lead-in); write a literal one as \\)");
        ok = false;
      } else {
        closer.leadinSource = p.value;
        if (citeRe.test(p.value)) {
          error(lineNo, "@cite is not allowed in a lead-in");
          ok = false;
        } else if (noteRe.test(p.value)) {
          error(lineNo, "footnote references are not allowed in a lead-in; put them in the slide body");
          ok = false;
        }
        if (rest.slice(p.end).trim()) {
          error(lineNo, `unexpected text after @end: "${rest.slice(p.end).trim()}"`);
          ok = false;
        }
      }
    } else if (rest.trim()) {
      error(lineNo, `unexpected text after @end: "${rest.trim()}"`);
      ok = false;
    }
    if (!open) {
      error(lineNo, "@end without a matching @slide");
      out.push("");
      continue;
    }
    open = false;
    if (!ok) {
      out.push(markerFor("end", -1));
      continue;
    }
    const id = store.closers.length;
    store.closers.push(closer);
    out.push(markerFor("end", id));
  }

  if (open) error(openLine, "@slide is never closed with @end");
  return { source: out.join("\n"), store };
}

// ─── Inline markdown for [title] and (lead-in) ───────────────────────────────

const inlineProcessor = unified().use(remarkParse).use(remarkGfm, { singleTilde: false }).use(remarkUnderline).use(remarkMath);

export function parseInline(source: string): Inline[] {
  if (!source.trim()) return [];
  const tree = inlineProcessor.parse(source) as Root;
  const first = tree.children[0];
  if (first?.type === "paragraph") return first.children as Inline[];
  return [{ type: "text", value: source }];
}

// ─── Phase 2: remark plugin ──────────────────────────────────────────────────

export interface SlideBlocksOptions {
  store: DirectiveStore;
  mode: "document" | "analyze";
}

export interface SlideBlocksData {
  blocks: SlideBlock[];
  diagnostics: Diagnostic[];
  /** Labels defined inside `nodoc` blocks. */
  nodocLabels: Set<string>;
}

function headingRefOf(node: Heading, locate: Locator): HeadingRef {
  return {
    depth: node.depth,
    inline: node.children as Inline[],
    label: (node.data as any)?.label ?? null,
    loc: locate(node.position?.start.line ?? 1),
  };
}

const remarkSlideBlocks: Plugin<[SlideBlocksOptions], Root> = function (options) {
  const { store, mode } = options;
  return (tree: Root, file: any) => {
    const diagnostics = [...store.diagnostics];
    const blocks: SlideBlock[] = [];
    const nodocLabels = new Set<string>();
    const stack: (HeadingRef | undefined)[] = [];
    const out: RootContent[] = [];
    let current: SlideBlock | null = null;

    for (const node of tree.children) {
      const marker = node.type === "html" ? parseMarker((node as any).value) : null;
      if (marker?.kind === "slide") {
        const opener = store.openers[marker.id];
        const block: SlideBlock = {
          kind: "slideBlock",
          id: blocks.length,
          options: opener.options,
          title: opener.titleSource !== undefined ? parseInline(opener.titleSource) : undefined,
          headingInEffect: [...stack].reverse().find(Boolean),
          headingStack: [...stack],
          children: [],
          loc: store.locate(opener.line),
          endLoc: store.locate(opener.line),
        };
        blocks.push(block);
        current = block;
        continue;
      }
      if (marker?.kind === "note") {
        const note = store.notes[marker.id];
        if (current && note) {
          // Notes live in the block's children, in order, so the builder can attach each to the
          // slide holding the content before it. They are never part of the document.
          current.children.push({
            type: "vfmNote",
            note: parseInline(note.source),
            position: (node as any).position,
          } as unknown as Block);
        }
        continue;
      }
      if (marker?.kind === "end") {
        if (current) {
          const closer = store.closers[marker.id];
          if (closer) {
            current.endLoc = store.locate(closer.line);
            if (closer.leadinSource !== undefined) current.leadin = parseInline(closer.leadinSource);
          }
          current = null;
        }
        continue;
      }
      if (node.type === "heading") {
        const ref = headingRefOf(node as Heading, store.locate);
        stack[ref.depth - 1] = ref;
        for (let d = ref.depth; d < 6; d++) stack[d] = undefined;
      }
      if (current) current.children.push(node as Block);
      out.push(node);
    }

    // Markers anywhere but the top level are directives in the wrong place.
    const rootMarkers = new Set<unknown>();
    for (const n of tree.children) if (n.type === "html" && parseMarker((n as any).value)) rootMarkers.add(n);
    visit(tree, "html", (node: any) => {
      if (rootMarkers.has(node) || !parseMarker(node.value)) return;
      diagnostics.push({
        code: "syntax",
        severity: "error",
        message: "@slide and @end can only wrap top-level blocks (not inside a list, quote or fenced div)",
        loc: store.locate(node.position?.start.line ?? 1),
      });
    });

    for (const block of blocks) {
      if (block.options.nodoc) for (const l of labelsOf(block.children)) nodocLabels.add(l);
    }

    if (mode === "document") {
      const removed = new Set<unknown>();
      for (const block of blocks) if (block.options.nodoc) block.children.forEach((c) => removed.add(c));
      tree.children = out.filter((n) => !removed.has(n));
    } else {
      tree.children = out;
    }

    const data: SlideBlocksData = { blocks, diagnostics, nodocLabels };
    file.data.slideBlocks = data;
    // Slide mode collects errors so `check` can report all of them; the builder throws.
    if (mode === "document" && diagnostics.some((d) => d.severity === "error")) {
      throw new SlideDirectiveError(diagnostics);
    }
  };
};

export default remarkSlideBlocks;
