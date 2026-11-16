/**
 * plugins/sub-sup.ts
 *
 * Remark plugin for subscripts and superscripts in running text, outside math:
 *
 *   H_{2}O     → H<sub>2</sub>O
 *   x^{2}      → x<sup>2</sup>
 *
 * Same shape as LaTeX, so it does not compete with `~text~` (underline), `~~text~~` (strikethrough) or
 * `[^note]` (footnotes). Like underline.ts it is a micromark extension: a backslash escape (`\^`, `\_`)
 * is read before it gets here and so leaves the pair as literal text, and headings, table cells, captions,
 * slide titles and the fenced-div inner parser get the syntax for free. Code and math are separate
 * constructs and are never seen by this one.
 *
 * The text between the braces is parsed as inline Markdown again, so `m_{*i*}` and `10^{-3}` work and
 * braces may nest (`a^{b_{c}}`). A pair needs at least one non-space character and must close on the
 * same line; otherwise it stays literal text.
 *
 * Usage:
 *   .use(remarkSubSup)
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
    subSup: SubSupNode;
  }
  interface RootContentMap {
    subSup: SubSupNode;
  }
}

export interface SubSupNode {
  type: "subSup";
  children: import("mdast").PhrasingContent[];
  data?: { hName?: "sub" | "sup" };
}

const CARET = 94;
const UNDERSCORE = 95;
const OPEN = 123;
const CLOSE = 125;
const isEol = (c: Code) => c === -5 || c === -4 || c === -3;
const isSpace = (c: Code) => c === 32 || c === -2 || c === -1;

function tokenizeSubSup(this: TokenizeContext, effects: Effects, ok: State, nok: State): State {
  let depth = 0;
  let hasText = false;

  const start: State = (code) => {
    if (code !== CARET && code !== UNDERSCORE) return nok(code);
    effects.enter("subSup" as any);
    effects.enter("subSupMarker" as any);
    effects.consume(code);
    return brace;
  };

  const brace: State = (code) => {
    if (code !== OPEN) return nok(code);
    effects.consume(code);
    effects.exit("subSupMarker" as any);
    effects.enter("subSupData" as any);
    depth = 1;
    return content;
  };

  const content: State = (code) => {
    if (code === null || isEol(code)) return nok(code);
    if (code === OPEN) depth++;
    if (code === CLOSE) {
      depth--;
      if (depth === 0) {
        if (!hasText) return nok(code);
        effects.exit("subSupData" as any);
        effects.enter("subSupMarker" as any);
        effects.consume(code);
        effects.exit("subSupMarker" as any);
        effects.exit("subSup" as any);
        return ok;
      }
    }
    if (!isSpace(code)) hasText = true;
    effects.consume(code);
    return content;
  };

  return start;
}

const construct: Construct = { name: "subSup", tokenize: tokenizeSubSup, add: "before" } as Construct;
const micromarkExtension: MicromarkExtension = { text: { [CARET]: construct, [UNDERSCORE]: construct } };

/** The constructs the inner text may use; sub/superscripts nest. */
const inner = {
  extensions: [gfm({ singleTilde: false }), math(), micromarkExtension],
  mdastExtensions: [gfmFromMarkdown(), mathFromMarkdown()],
};

const fromMarkdownExtension = {
  enter: {
    subSup(this: any, token: any) {
      const marker = this.sliceSerialize(token).charCodeAt(0);
      this.enter({ type: "subSup", children: [], data: { hName: marker === CARET ? "sup" : "sub" } }, token);
    },
  },
  exit: {
    subSupData(this: any, token: any) {
      const node = this.stack[this.stack.length - 1] as SubSupNode;
      const raw = this.sliceSerialize(token);
      const parsed = fromMarkdown(raw, { ...inner, mdastExtensions: [...inner.mdastExtensions, fromMarkdownExtension] } as any);
      const first = parsed.children[0];
      node.children.push(...(first?.type === "paragraph" ? (first.children as any[]) : [{ type: "text", value: raw }]));
    },
    subSup(this: any, token: any) {
      this.exit(token);
    },
  },
};

const remarkSubSup: Plugin<[], Root> = function () {
  const data = this.data() as any;
  (data.micromarkExtensions ??= []).push(micromarkExtension);
  (data.fromMarkdownExtensions ??= []).push(fromMarkdownExtension);
};

export default remarkSubSup;
