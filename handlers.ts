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
import { inlineMathHandler } from "./plugins/inline-math";
import { captionNodes } from "./plugins/caption-nodes";
import { isVideoUrl } from "./plugins/video-url";

export { highlightHandler };
export { inlineMathHandler };

// ─── Inline math handler ──────────────────────────────────────────────────────
// Lives in plugins/inline-math.ts (captions use it too); re-exported here.

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

// "Figure 1.2: " followed by the caption, which is inline Markdown (math, sub/superscripts, emphasis).
// `caption` is the caption's source text, not its plain text.
// Slides leave the period off (`data.noCaptionPeriod`, set by renderTree); `data.captionRewrite` turns `@cite(...)` into links.
function captionParts(displayText: string | undefined, caption: string | undefined, data?: any): ElementContent[] {
  const nodes = (c: string) => captionNodes(data?.noCaptionPeriod ? c.trimEnd() : ensurePeriod(c), data?.captionRewrite);
  if (displayText && caption) return [text(`${displayText}: `), ...nodes(caption)];
  if (displayText) return [text(displayText)];
  if (caption) return nodes(caption);
  return [];
}

// Builds a unified <figcaption> element used by figures and code listings.
// Structure: <figcaption><strong>Label N.N: Caption text.</strong></figcaption>
function buildFigcaption(
  displayText: string | undefined,
  caption: string | undefined,
  data?: any
): Element | null {
  const parts = captionParts(displayText, caption, data);

  if (parts.length === 0) return null;

  return el("figcaption", {}, [el("strong", {}, parts)]);
}

// Builds caption children for a <caption> element inside a <table>.
// Same structure as figcaption but returns ElementContent[] for splicing.
function buildTableCaptionChildren(
  displayText: string | undefined,
  caption: string | undefined,
  data?: any
): ElementContent[] {
  const parts = captionParts(displayText, caption, data);

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

  // Classes set by the slide builder (the large title of a section slide, "continued" headings) survive.
  const className = data?.hProperties?.className;
  return el(`h${heading.depth}`, { ...(id ? { id } : {}), ...(className ? { className } : {}) }, children);
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
  const plain: string | undefined = data?.caption ?? imgNode.alt ?? undefined;
  const caption: string | undefined = data?.captionSource ?? plain;
  const id: string | undefined = data?.label ?? undefined;

  // A video uses the image syntax; the browser plays it natively (REQ-141, REQ-143). No `type` attribute:
  // "video/quicktime" makes Chromium refuse a .mov it could play.
  const mediaEl = isVideoUrl(imgNode.url)
    ? el("video", {
        src: imgNode.url,
        controls: true,
        preload: "metadata",
        playsInline: true,
        ...(plain ? { ariaLabel: plain } : {}),
        ...(imgNode.title ? { title: imgNode.title } : {}),
      }, [])
    : el("img", {
        src: imgNode.url,
        alt: plain ?? "",
        ...(imgNode.title ? { title: imgNode.title } : {}),
      }, []);

  const figcaption = buildFigcaption(displayText, caption ?? undefined, data);
  const children: ElementContent[] = [mediaEl];
  if (figcaption) children.push(figcaption);

  const figure = el("figure", {
    className: ["labeled-figure"],
    ...(id ? { id } : {}),
  }, children);
  // A double click on the picture jumps to the line of the image, not of the paragraph around it.
  if (imgNode.position) figure.position = imgNode.position;

  // Text written around the image stays: before it as a paragraph above the figure, after it as one below.
  const at = para.children.indexOf(imgNode);
  const around = (nodes: any[]): Element[] => {
    const blank = nodes.every((c) => c.type === "text" && !c.value.trim());
    return blank ? [] : [el("p", {}, state.all({ ...para, children: nodes } as any))];
  };
  const out: Element[] = [...around(para.children.slice(0, at)), figure, ...around(para.children.slice(at + 1))];
  return out.length === 1 ? figure : out;
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
  const caption: string | undefined = data?.captionSource ?? data?.caption ?? undefined;
  const id: string | undefined = data?.label ?? undefined;

  // Let state.all render the thead/tbody rows normally
  const tableChildren: ElementContent[] = state.all(node);

  // Prepend <caption> if we have something to show
  const captionChildren = buildTableCaptionChildren(displayText, caption, data);
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

  const figcaption = buildFigcaption(displayText, caption ?? undefined, data);
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