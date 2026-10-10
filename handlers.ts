/**
 * handlers.ts
 *
 * Custom rehype handlers for all numbered and captioned elements.
 * These convert mdast nodes (with data attached by labels.ts, registry.ts,
 * equation-labels.ts, and fenced-divs.ts) into hast element trees.
 *
 * Handlers:
 *   heading        — prepends section number as a styled <span>
 *   image          — wraps in <figure> with <figcaption> below
 *   table          — wraps with <caption> inside <table>
 *   code           — wraps in <figure> with <figcaption> below
 *   math           — anchor target + equation number(s) outside KaTeX
 *   fencedDiv      — theorem env with bold "Printed Name N.N -- Title" header
 *   highlight      — <mark> (re-exported from highlight plugin for convenience)
 */

import type { Handler, State } from "mdast-util-to-hast";
import type { Element, ElementContent, Text as HastText, Properties } from "hast";
import type { Heading, Image, Table, Code } from "mdast";
import type { FencedDivNode } from "./plugins/fenced-divs";
import type { EquationLabelData } from "./plugins/equation-labels";
import { highlightHandler } from "./plugins/highlight";

export { highlightHandler };

// ─── Inline math handler ──────────────────────────────────────────────────────
// remark-math produces `inlineMath` nodes which remarkRehype doesn't know
// about, falling back to rendering them as <code>. We handle them directly
// using KaTeX in inline mode.

export const inlineMathHandler: Handler = (_state, node: any) => {
  let katexHtml: string;
  try {
    katexHtml = katex.renderToString(node.value ?? "", {
      displayMode: false,
      throwOnError: false,
      trust: true,
    });
  } catch {
    katexHtml = `<span class="katex-error">${node.value}</span>`;
  }
  return el("span", { className: ["math", "math-inline"] }, [
    { type: "raw", value: katexHtml } as any,
  ]);
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function text(value: string): HastText {
  return { type: "text", value };
}

function span(
  className: string,
  children: ElementContent[]
): Element {
  return {
    type: "element",
    tagName: "span",
    properties: { className: [className] },
    children,
  };
}

function el(
  tagName: string,
  properties: Properties,
  children: ElementContent[]
): Element {
  return { type: "element", tagName, properties, children };
}

// Appends a period to a string if it doesn't already end with one.
function ensurePeriod(s: string): string {
  const trimmed = s.trimEnd();
  return /[.!?]$/.test(trimmed) ? trimmed : trimmed + ".";
}

// Builds a unified <figcaption> element used by figures and code listings.
// Structure: <figcaption><strong>Label N.N: Caption text.</strong></figcaption>
function buildFigcaption(
  displayText: string | undefined,
  caption: string | undefined
): Element | null {
  const parts: ElementContent[] = [];

  if (displayText && caption) {
    parts.push(text(`${displayText}: ${ensurePeriod(caption)}`));
  } else if (displayText) {
    parts.push(text(displayText));
  } else if (caption) {
    parts.push(text(ensurePeriod(caption)));
  }

  if (parts.length === 0) return null;

  return el("figcaption", {}, [el("strong", {}, parts)]);
}

// Builds caption children for a <caption> element inside a <table>.
// Same structure as figcaption but returns ElementContent[] for splicing.
function buildTableCaptionChildren(
  displayText: string | undefined,
  caption: string | undefined
): ElementContent[] {
  const parts: ElementContent[] = [];

  if (displayText && caption) {
    parts.push(text(`${displayText}: ${ensurePeriod(caption)}`));
  } else if (displayText) {
    parts.push(text(displayText));
  } else if (caption) {
    parts.push(text(ensurePeriod(caption)));
  }

  if (parts.length === 0) return [];
  return [el("strong", {}, parts)];
}

// ─── Heading handler ──────────────────────────────────────────────────────────
// Renders: <h2 id="sec:inline"><span class="section-number">1.1</span> Title</h2>

export const headingHandler: Handler = (state, node) => {
  const heading = node as Heading;
  const data = heading.data as any;
  const displayNumber: string | undefined = data?.displayNumber;
  const id: string | undefined = data?.hProperties?.id ?? data?.label;

  const children: ElementContent[] = state.all(node);

  if (displayNumber) {
    children.unshift(
      span("section-number", [text(displayNumber)]),
      text(" ")
    );
  }

  return el(`h${heading.depth}`, id ? { id } : {}, children);
};

// ─── Figure handler ───────────────────────────────────────────────────────────
// Images in mdast are inline nodes inside paragraphs. remarkRehype dispatches
// handlers at the block level, so we intercept at the paragraph level and
// detect whether it contains a labeled image.
// Renders:
//   <figure class="labeled-figure" id="fig:diagram">
//     <img src="..." alt="..." />
//     <figcaption><span class="caption-label">Figure 1.6.1</span>: Caption text</figcaption>
//   </figure>
// Falls back to a normal <p> if the paragraph doesn't contain a labeled image.

export const paragraphHandler: Handler = (state, node) => {
  const para = node as any;

  // Demoted heading (shifted beyond h6) — render as plain <p> with id preserved
  if (para.data?.demotedHeading) {
    const props: Properties = {};
    if (para.data?.hProperties?.id) props.id = para.data.hProperties.id;
    return el("p", props, state.all(node));
  }

  // Find an image child that has been labeled
  const imgNode = para.children?.find(
    (c: any) => c.type === "image" && c.data?.labelType === "fig"
  );

  if (!imgNode) {
    // Not a figure paragraph — render as normal <p>
    return el("p", {}, state.all(node));
  }

  const data = imgNode.data as any;
  const displayText: string | undefined = data?.suppressLabel ? undefined : data?.displayText;
  const caption: string | undefined = data?.caption ?? imgNode.alt ?? undefined;
  const id: string | undefined = data?.label ?? undefined;

  const imgEl = el("img", {
    src: imgNode.url,
    alt: caption ?? "",
    ...(imgNode.title ? { title: imgNode.title } : {}),
  }, []);

  const figcaption = buildFigcaption(displayText, caption ?? undefined);
  const children: ElementContent[] = [imgEl];
  if (figcaption) children.push(figcaption);

  return el("figure", {
    className: ["labeled-figure"],
    ...(id ? { id } : {}),
  }, children);
};

// ─── Table handler ────────────────────────────────────────────────────────────
// Renders the standard table with a <caption> element as first child:
//   <table id="tab:comparison">
//     <caption><span class="caption-label">Table 1.5.1</span> Caption text</caption>
//     <thead>...</thead>
//     <tbody>...</tbody>
//   </table>

export const tableHandler: Handler = (state, node) => {
  const table = node as Table;
  const data = table.data as any;
  const displayText: string | undefined = data?.suppressLabel ? undefined : data?.displayText;
  const caption: string | undefined = data?.caption ?? undefined;
  const id: string | undefined = data?.label ?? undefined;

  // Let state.all render the thead/tbody rows normally
  const tableChildren: ElementContent[] = state.all(node);

  // Prepend <caption> if we have something to show
  const captionChildren = buildTableCaptionChildren(displayText, caption);
  if (captionChildren.length > 0) {
    tableChildren.unshift(el("caption", {}, captionChildren));
  }

  return el("table", {
    ...(id ? { id } : {}),
  }, tableChildren);
};

// ─── Code listing handler ─────────────────────────────────────────────────────
// Renders:
//   <figure class="code-listing" id="lst:fib">
//     <pre><code class="language-python">...</code></pre>
//     <figcaption><span class="caption-label">Listing 1.9.1</span> Fibonacci</figcaption>
//   </figure>

export const codeHandler: Handler = (state, node) => {
  const code = node as Code;
  const data = code.data as any;
  const displayText: string | undefined = data?.suppressLabel ? undefined : data?.displayText;
  console.log("[codeHandler] data:", JSON.stringify({ suppressLabel: data?.suppressLabel, displayText: data?.displayText, resolved: displayText }));
  const caption: string | undefined = data?.caption ?? undefined;
  const id: string | undefined = data?.label ?? undefined;
  const lang: string | undefined = code.lang ?? undefined;

  const codeEl = el(
    "code",
    lang ? { className: [`language-${lang}`] } : {},
    [text(code.value)]
  );
  const preEl = el("pre", {}, [codeEl]);

  const figcaption = buildFigcaption(displayText, caption ?? undefined);
  const children: ElementContent[] = [preEl];
  if (figcaption) children.push(figcaption);

  return el("figure", {
    className: ["code-listing"],
    ...(id ? { id } : {}),
  }, children);
};

// ─── Math handler ─────────────────────────────────────────────────────────────
// Renders KaTeX directly (bypassing rehype-katex) so we can wrap the output
// with anchor targets and equation numbers.
//
// For block-level label:
//   <div class="equation-wrapper">
//     <span id="eq:label" class="equation-anchor"></span>
//     <div class="equation-block">...katex html...</div>
//   </div>
//
// For per-line labels, each labeled line gets a number on the right:
//   <div class="equation-wrapper">
//     <div class="equation-row">
//       <span id="eq:sum1" class="equation-anchor"></span>
//       <div class="equation-block">...katex html...</div>
//       <span class="equation-number">(1.1a)</span>
//     </div>
//     <div class="equation-row">
//       <div class="equation-block">...katex html...</div>
//     </div>
//   </div>

import katex from "katex";

export const mathHandler: Handler = (_state, node: any) => {
  const data = node.data as (EquationLabelData & {
    displayNumber?: string;
    lineDisplayNumbers?: Record<string, string>;
  }) | undefined;

  const blockLabel = data?.blockLabel ?? null;
  const lineLabels = data?.lineLabels ?? [];
  const lineDisplayNumbers = data?.lineDisplayNumbers ?? {};
  const value: string = node.value ?? "";

  // Render KaTeX to HTML string
  let katexHtml: string;
  try {
    katexHtml = katex.renderToString(value, {
      displayMode: true,
      throwOnError: false,
      trust: true,
    });
  } catch {
    katexHtml = `<span class="katex-error">${value}</span>`;
  }

  const katexNode = (): Element => ({
    type: "element",
    tagName: "div",
    properties: { className: ["equation-block"] },
    children: [{ type: "raw", value: katexHtml } as any],
  });

  const wrapperChildren: ElementContent[] = [];

  if (lineLabels.length > 0) {
    // Per-line mode: each line is a grid row —
    //   [spacer | equation (centered) | number (right)]
    // The spacer mirrors the number column width so the equation stays centered.
    const lines = value.split("\n").filter((l) => l.trim() !== "");
    const lineLabelsByIndex = new Map(
      lineLabels.map((ll) => [ll.lineIndex, ll])
    );

    lines.forEach((line, idx) => {
      const ll = lineLabelsByIndex.get(idx);

      let lineKatex: string;
      try {
        lineKatex = katex.renderToString(line, {
          displayMode: true,
          throwOnError: false,
          trust: true,
        });
      } catch {
        lineKatex = `<span class="katex-error">${line}</span>`;
      }

      const rowChildren: ElementContent[] = [
        // Spacer mirrors the number column so KaTeX stays centered
        el("span", { className: ["equation-number-spacer"] }, []),
        el("div", { className: ["equation-block"] }, [
          { type: "raw", value: lineKatex } as any,
        ]),
        // Number column — empty span if this line has no label
        ll
          ? el("span", { className: ["equation-number"] }, [
              el("span", { id: ll.label, className: ["equation-anchor"] }, []),
              text(`(${lineDisplayNumbers[ll.label] ?? ""})`),
            ])
          : el("span", { className: ["equation-number-spacer"] }, []),
      ];

      wrapperChildren.push(
        el("div", { className: ["equation-row"] }, rowChildren)
      );
    });
  } else {
    // Single block — same grid structure
    const numberText = data?.displayNumber
      ? `(${data.displayNumber})`
      : "";

    const rowChildren: ElementContent[] = [
      el("span", { className: ["equation-number-spacer"] }, []),
      el("div", { className: ["equation-block"] }, [
        { type: "raw", value: katexHtml } as any,
      ]),
      numberText
        ? el("span", { className: ["equation-number"] }, [text(numberText)])
        : el("span", { className: ["equation-number-spacer"] }, []),
    ];

    if (blockLabel) {
      wrapperChildren.push(
        el("span", { id: blockLabel, className: ["equation-anchor"] }, [])
      );
    }
    wrapperChildren.push(
      el("div", { className: ["equation-row"] }, rowChildren)
    );
  }

  return el("div", { className: ["equation-wrapper"] }, wrapperChildren);
};

// ─── Shifted heading handler (beyond h6) ─────────────────────────────────────
// Headings shifted past h6 render as <p><strong>Title</strong></p>.
// No section number. Still gets an id if it had a label.

export const shiftedHeadingHandler: Handler = (state, node: any) => {
  const data = node.data as any;
  const id: string | undefined = data?.hProperties?.id ?? data?.label ?? undefined;

  return el("p", { ...(id ? { id } : {}) }, [
    el("strong", {}, state.all(node)),
  ]);
};
// Renders:
//   <div class="theorem-env theorem-lemma" id="lem:euclid">
//     <p class="theorem-header"><strong>Lemma 1.2.1 — Euclid's Lemma</strong></p>
//     <div class="theorem-body">...</div>
//   </div>
// Without title: <strong>Lemma 1.2.1</strong>

export const fencedDivHandler: Handler = (state, node: any): Element => {
  const fenced = node as FencedDivNode;
  const displayNumber: string | undefined =
    (node as any).suppressLabel ? undefined : (node as any).displayNumber;

  const PRINTED: Record<string, string> = {
    theorem: "Theorem", lemma: "Lemma", corollary: "Corollary",
    proposition: "Proposition", conjecture: "Conjecture",
    definition: "Definition", example: "Example",
    exercise: "Exercise", hypothesis: "Hypothesis",
  };
  const printedName = PRINTED[fenced.envType] ?? fenced.envType;

  let headerText = displayNumber
    ? `${printedName} ${displayNumber}`
    : printedName;
  if (fenced.name) {
    headerText += ` \u2014 ${fenced.name}`;
  }

  const properties: Properties = {
    className: ["theorem-env", `theorem-${fenced.envType}`],
  };
  if (fenced.label) properties.id = fenced.label;

  return el("div", properties, [
    el("p", { className: ["theorem-header"] }, [
      el("strong", {}, [text(headerText)]),
    ]),
    el("div", { className: ["theorem-body"] }, state.all(node)),
  ]);
};