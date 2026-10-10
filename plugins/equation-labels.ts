/**
 * plugins/equation-labels.ts
 *
 * Remark plugin that extracts {#eq:label} tokens from display math blocks
 * ($$...$$) and attaches structured label data to each `math` node.
 *
 * Must run after remark-math (which produces `math` nodes) and before the
 * registry pre-pass (which reads the attached data to assign numbers).
 *
 * Syntax:
 *
 *   Block-level label (on the opening $$ line):
 *     $${#eq:whole}
 *     \sum ... = \frac{\pi^2}{6}
 *     $$
 *
 *   Per-line labels (at the end of individual lines inside $$):
 *     $$
 *     \sum ... {#eq:sum1}
 *     \sum ... {#eq:sum2}
 *     $$
 *
 *   Both together:
 *     $${#eq:whole}
 *     \sum ... {#eq:sum1}
 *     \sum ... {#eq:sum2}
 *     $$
 *
 * Output attached to math node.data:
 *   {
 *     blockLabel: string | null,   // full label from opening line (may include UUID prefix)
 *     lineLabels: LineLabel[],     // per-line labels with cleaned line index
 *     cleanValue: string,          // LaTeX with all {#eq:...} tokens removed
 *   }
 *
 * Equation numbering rules (enforced by the registry, not this plugin):
 *   - Every $$ block with at least one label (block or line) gets a number.
 *   - Block-level label → anchor target only, no displayed number.
 *   - Per-line labels → displayed as (1.2a), (1.2b), etc. Only labeled lines
 *     consume letters; unlabeled lines within the same block are skipped.
 *   - Letter sequencing: a–z, then aa, ab, ... (bijective base-26).
 *   - Unlabeled blocks (no block label, no line labels) → no number, no entry.
 *
 * Usage in pipeline.ts:
 *   import remarkEquationLabels from "./plugins/equation-labels";
 *   ...
 *   .use(remarkMath)
 *   .use(remarkEquationLabels)   // immediately after remarkMath
 */

import type { Plugin } from "unified";
import type { Root } from "mdast";
import { visit } from "unist-util-visit";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LineLabel {
  label: string;      // full label string e.g. "eq:sum1" or "UUID-eq:sum1"
  lineIndex: number;  // 0-based index into the cleaned value's lines
}

export interface EquationLabelData {
  blockLabel: string | null;
  lineLabels: LineLabel[];
  cleanValue: string;
}

declare module "mdast" {
  interface MathData {
    blockLabel?: string | null;
    lineLabels?: LineLabel[];
    cleanValue?: string;
  }
}

// ─── Label pattern ────────────────────────────────────────────────────────────
// Matches {#eq:label} or {#UUID-eq:label} inside math blocks.
// The UUID prefix (if present) is a UUID v4 followed by a hyphen.
// Only eq-type labels are valid inside math blocks.
//
// FIX: the original pattern only matched bare {#eq:...}. After injectUuid
// runs, labels become {#UUID-eq:...}, so the pattern must accept an optional
// UUID v4 prefix before the "eq" type segment.

const UUID_PREFIX_PAT =
  "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}-";

// Matches the full label token at end-of-string, capturing the full label
// (including any UUID prefix) as group 1.
const EQ_LABEL_RE = new RegExp(
  `\\s*\\{#(((?:${UUID_PREFIX_PAT})?eq:[^}]+))\\}\\s*$`,
  "i"
);

function extractEqLabel(text: string): { label: string; textBefore: string } | null {
  const match = text.match(EQ_LABEL_RE);
  if (!match) return null;
  return {
    // group 1 is the full label, e.g. "eq:sum1" or "UUID-eq:sum1"
    label: match[1].trim(),
    textBefore: text.slice(0, match.index).trimEnd(),
  };
}

// ─── Block-level label ────────────────────────────────────────────────────────
// remark-math puts everything after the opening $$ on the same line into the
// node's `meta` property (similar to fenced code blocks).

function extractBlockLabel(node: any): string | null {
  const meta: string = node.meta ?? "";
  if (!meta.trim()) return null;
  const parsed = extractEqLabel(meta.trim());
  if (!parsed) return null;
  // Clear meta so rehype-katex doesn't see it
  node.meta = parsed.textBefore || null;
  return parsed.label;
}

// ─── Per-line label extraction ────────────────────────────────────────────────
// Scans each line of the math value for a trailing {#eq:label} token.
// Returns the cleaned value and the list of line labels.

interface LineParseResult {
  cleanValue: string;
  lineLabels: LineLabel[];
}

function extractLineLabels(value: string): LineParseResult {
  const inputLines = value.split("\n");
  const cleanLines: string[] = [];
  const lineLabels: LineLabel[] = [];

  for (const line of inputLines) {
    const parsed = extractEqLabel(line);
    if (parsed) {
      lineLabels.push({
        label: parsed.label,
        lineIndex: cleanLines.length,
      });
      cleanLines.push(parsed.textBefore);
    } else {
      cleanLines.push(line);
    }
  }

  return {
    cleanValue: cleanLines.join("\n"),
    lineLabels,
  };
}

// ─── Remark plugin ────────────────────────────────────────────────────────────

const remarkEquationLabels: Plugin<[], Root> = function () {
  return (tree: Root) => {
    visit(tree, "math", (node: any) => {
      const blockLabel = extractBlockLabel(node);
      const { cleanValue, lineLabels } = extractLineLabels(node.value ?? "");

      node.data = node.data ?? {};
      node.data.blockLabel = blockLabel;
      node.data.lineLabels = lineLabels;
      node.data.cleanValue = cleanValue;

      // Replace the raw value with the cleaned version so rehype-katex
      // receives LaTeX with no {#eq:...} tokens.
      node.value = cleanValue;
    });
  };
};

export default remarkEquationLabels;