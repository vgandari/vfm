/**
 * slides/labels.ts
 *
 * Which labels a node defines (figures, tables, code, equations, headings,
 * environments, algorithms, scores) and which cross-references it contains.
 */

import { visit } from "unist-util-visit";
import type { Block } from "./types";

export const XREF_RE = /\[@([^\]:]+:[^\]]+)\]/g;

function direct(node: any): string[] {
  const out: string[] = [];
  const d = node.data;
  switch (node.type) {
    case "heading":
    case "shiftedHeading":
    case "image":
    case "table":
    case "code":
      if (d?.label) out.push(d.label);
      break;
    case "math":
      if (d?.blockLabel) out.push(d.blockLabel);
      for (const l of d?.lineLabels ?? []) out.push(l.label);
      break;
    case "fencedDiv":
    case "algorithmBlock":
    case "musicBlock":
    case "mermaidBlock":
      if (node.label) out.push(node.label);
      break;
  }
  return out;
}

/** Labels defined anywhere inside `nodes`. */
export function labelsOf(nodes: readonly Block[] | Block): string[] {
  const out: string[] = [];
  const list = Array.isArray(nodes) ? nodes : [nodes];
  for (const root of list) {
    visit(root as any, (node: any) => {
      out.push(...direct(node));
    });
  }
  return out;
}

/** Cross-reference labels written in the text of `nodes` (not code or math). */
export function xrefsOf(nodes: readonly any[] | any): string[] {
  const out: string[] = [];
  const list = Array.isArray(nodes) ? nodes : [nodes];
  for (const root of list) {
    visit(root, "text", (node: any) => {
      for (const m of node.value.matchAll(XREF_RE)) out.push(m[1]);
    });
  }
  return out;
}
