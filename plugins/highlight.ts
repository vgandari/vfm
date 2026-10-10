/**
 * plugins/highlight.ts
 *
 * Remark plugin that adds ==text== syntax, rendered as <mark>.
 *
 * Hooks into the micromark tokenizer (the layer beneath remark) to teach the
 * parser about a new inline construct, then adds an mdast-util handler that
 * converts those tokens into a custom `highlight` node. Finally, a rehype
 * handler converts that node to a <mark> element.
 *
 * Usage in pipeline.ts:
 *   import remarkHighlight from "./plugins/highlight";
 *   ...
 *   .use(remarkParse)
 *   .use(remarkGfm)
 *   .use(remarkHighlight)   // ← after remarkParse, before remarkRehype
 *   .use(remarkRehype, { handlers: { highlight: highlightHandler } })
 *
 * The handler is exported as `highlightHandler` for use in the remarkRehype
 * options.
 */

import type { Root } from "mdast";
import type { Plugin } from "unified";
import type {
  Effects,
  State,
  Code,
  TokenizeContext,
  Construct,
  Extension as MicromarkExtension,
} from "micromark-util-types";
import type { Handler } from "mdast-util-to-hast";

// ─── Types ────────────────────────────────────────────────────────────────────

declare module "mdast" {
  interface PhrasingContentMap {
    highlight: HighlightNode;
  }
  interface RootContentMap {
    highlight: HighlightNode;
  }
}

interface HighlightNode {
  type: "highlight";
  children: import("mdast").PhrasingContent[];
  data?: {
    hName?: string;
    hChildren?: unknown[];
  };
}

// ─── Micromark extension ──────────────────────────────────────────────────────
// Teaches the low-level tokenizer to recognise ==...==.

const EQUALS = 61; // "=" char code

function tokenizeHighlight(
  this: TokenizeContext,
  effects: Effects,
  ok: State,
  nok: State
): State {
  let markerCount = 0;

  const start: State = (code: Code) => {
    if (code !== EQUALS) return nok(code);
    effects.enter("highlight" as any);
    effects.enter("highlightMarker" as any);
    return openMarker(code);
  };

  const openMarker: State = (code: Code) => {
    if (code !== EQUALS) return nok(code);
    effects.consume(code);
    markerCount++;
    if (markerCount === 2) {
      effects.exit("highlightMarker" as any);
      effects.enter("highlightData" as any);
      return content;
    }
    return openMarker;
  };

  const content: State = (code: Code) => {
    // Disallow empty ==== and newlines inside
    if (code === null || code === -5 || code === -4 || code === -3) {
      return nok(code);
    }
    if (code === EQUALS) {
      effects.exit("highlightData" as any);
      effects.enter("highlightMarker" as any);
      return closeMarker(code);
    }
    effects.enter("data" as any);
    return data(code);
  };

  const data: State = (code: Code) => {
    if (
      code === null ||
      code === -5 ||
      code === -4 ||
      code === -3 ||
      code === EQUALS
    ) {
      effects.exit("data" as any);
      return content(code);
    }
    effects.consume(code);
    return data;
  };

  let closeMarkerCount = 0;
  const closeMarker: State = (code: Code) => {
    if (code !== EQUALS) return nok(code);
    effects.consume(code);
    closeMarkerCount++;
    if (closeMarkerCount === 2) {
      effects.exit("highlightMarker" as any);
      effects.exit("highlight" as any);
      return ok;
    }
    return closeMarker;
  };

  return start;
}

const highlightConstruct: Construct = {
  name: "highlight",
  tokenize: tokenizeHighlight,
};

const micromarkExtension: MicromarkExtension = {
  text: { [EQUALS]: highlightConstruct },
};

// ─── mdast-util extension ─────────────────────────────────────────────────────
// Converts the token stream into a `highlight` mdast node whose children are
// parsed as normal inline markdown.

const fromMarkdownExtension = {
  enter: {
    highlight(this: any, token: any) {
      this.enter({ type: "highlight", children: [] }, token);
    },
    highlightData(this: any, token: any) {
      this.buffer();
    },
  },
  exit: {
    highlightData(this: any, token: any) {
      const data = this.resume();
      const node = this.stack[this.stack.length - 1] as HighlightNode;
      // Re-parse the buffered text as inline children
      node.children.push({
        type: "text",
        value: data,
      } as any);
    },
    highlight(this: any, token: any) {
      this.exit(token);
    },
  },
};

// ─── rehype handler ───────────────────────────────────────────────────────────
// Converts the `highlight` mdast node to a <mark> hast element.
// Pass this to remarkRehype's `handlers` option.

export const highlightHandler: Handler = (state, node: any) => ({
  type: "element",
  tagName: "mark",
  properties: {},
  children: state.all(node),
});

// ─── Remark plugin ────────────────────────────────────────────────────────────

const remarkHighlight: Plugin<[], Root> = function () {
  const data = this.data() as any;

  (data.micromarkExtensions ??= []).push(micromarkExtension);
  (data.fromMarkdownExtensions ??= []).push(fromMarkdownExtension);
};

export default remarkHighlight;