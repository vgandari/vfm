/**
 * plugins/underline.ts
 *
 * Remark plugin for `~text~` (a single tilde), rendered as <u>. `~~text~~` stays strikethrough: the
 * pipeline loads remark-gfm with `singleTilde: false` so the two do not compete.
 *
 * Like highlight.ts it is a micromark extension, so escapes (`\~`), the fenced-div inner parser and
 * everything else that parses Markdown get it for free. The text between the tildes is parsed as
 * inline Markdown again, so `~**bold** and *italic*~` works.
 *
 * A pair needs non-space text right after the opening tilde and right before the closing one, on one
 * line, so "about ~5 to ~10 items" is left alone.
 *
 * Usage:
 *   .use(remarkGfm, { singleTilde: false })
 *   .use(remarkUnderline)
 */

import type { Root } from "mdast";
import type { Plugin } from "unified";
import type { Code, Construct, Effects, Extension as MicromarkExtension, State, TokenizeContext } from "micromark-util-types";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfm } from "micromark-extension-gfm";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { math } from "micromark-extension-math";
import { mathFromMarkdown } from "mdast-util-math";

declare module "mdast" {
  interface PhrasingContentMap {
    underline: UnderlineNode;
  }
  interface RootContentMap {
    underline: UnderlineNode;
  }
}

export interface UnderlineNode {
  type: "underline";
  children: import("mdast").PhrasingContent[];
  data?: { hName?: string };
}

const TILDE = 126;
const BACKSLASH = 92;
const isEol = (c: Code) => c === -5 || c === -4 || c === -3;
const isSpace = (c: Code) => c === 32 || c === -2 || c === -1;

function tokenizeUnderline(this: TokenizeContext, effects: Effects, ok: State, nok: State): State {
  const self = this;
  let last: Code = null;

  const start: State = (code) => {
    // The second tilde of "~~" belongs to strikethrough.
    if (code !== TILDE || self.previous === TILDE) return nok(code);
    effects.enter("underline" as any);
    effects.enter("underlineMarker" as any);
    effects.consume(code);
    return afterOpen;
  };

  const afterOpen: State = (code) => {
    if (code === TILDE || code === null || isEol(code) || isSpace(code)) return nok(code);
    effects.exit("underlineMarker" as any);
    effects.enter("underlineData" as any);
    return content(code);
  };

  const content: State = (code) => {
    if (code === null || isEol(code)) return nok(code);
    if (code === BACKSLASH) {
      effects.consume(code);
      last = code;
      return escaped;
    }
    if (code === TILDE && last !== null && !isSpace(last)) {
      effects.exit("underlineData" as any);
      effects.enter("underlineMarker" as any);
      effects.consume(code);
      return afterClose;
    }
    effects.consume(code);
    last = code;
    return content;
  };

  // "\x" is two characters of raw text; the inner parse turns it into x.
  const escaped: State = (code) => {
    if (code === null || isEol(code)) return nok(code);
    effects.consume(code);
    last = code;
    return content;
  };

  const afterClose: State = (code) => {
    if (code === TILDE) return nok(code); // "~a~~" is not ours
    effects.exit("underlineMarker" as any);
    effects.exit("underline" as any);
    return ok(code);
  };

  return start;
}

const construct: Construct = { name: "underline", tokenize: tokenizeUnderline, add: "before" } as Construct;
const micromarkExtension: MicromarkExtension = { text: { [TILDE]: construct } };

/** Same constructs the inner text may use. Underline itself is not repeated inside underline. */
const inner = { extensions: [gfm({ singleTilde: false }), math()], mdastExtensions: [gfmFromMarkdown(), mathFromMarkdown()] };

const fromMarkdownExtension = {
  enter: {
    underline(this: any, token: any) {
      this.enter({ type: "underline", children: [], data: { hName: "u" } }, token);
    },
  },
  exit: {
    underlineData(this: any, token: any) {
      const node = this.stack[this.stack.length - 1] as UnderlineNode;
      const raw = this.sliceSerialize(token);
      const parsed = fromMarkdown(raw, inner as any);
      const first = parsed.children[0];
      node.children.push(...(first?.type === "paragraph" ? (first.children as any[]) : [{ type: "text", value: raw }]));
    },
    underline(this: any, token: any) {
      this.exit(token);
    },
  },
};

const remarkUnderline: Plugin<[], Root> = function () {
  const data = this.data() as any;
  (data.micromarkExtensions ??= []).push(micromarkExtension);
  (data.fromMarkdownExtensions ??= []).push(fromMarkdownExtension);
};

export default remarkUnderline;
