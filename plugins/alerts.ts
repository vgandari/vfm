/**
 * plugins/alerts.ts
 *
 * Remark plugin that converts GitHub-style alert blockquotes into styled
 * alert divs with a title element.
 *
 * Syntax:
 *   > [!NOTE]
 *   > This is a note.
 *
 * Supported types: NOTE, TIP, IMPORTANT, WARNING, CAUTION
 *
 * Output HTML:
 *   <div class="alert alert-note">
 *     <p class="alert-title">Note</p>
 *     <p>This is a note.</p>
 *   </div>
 *
 * The plugin works by annotating the blockquote node's data.hName and
 * data.hProperties so remarkRehype renders it correctly without needing
 * a custom handler. The [!TYPE] paragraph is removed from the children
 * and replaced with an alert-title paragraph.
 *
 * Usage in pipeline.ts:
 *   import remarkAlerts from "./plugins/alerts";
 *   ...
 *   .use(remarkGfm)
 *   .use(remarkAlerts)   // after remarkGfm, before remarkRehype
 */

import type { Plugin } from "unified";
import type { Root, Blockquote, Paragraph, Text } from "mdast";
import { visit } from "unist-util-visit";

// ─── Supported alert types ────────────────────────────────────────────────────

const ALERT_TYPES: Record<string, string> = {
  NOTE: "Note",
  TIP: "Tip",
  IMPORTANT: "Important",
  WARNING: "Warning",
  CAUTION: "Caution",
};

// ─── Alert type detector ──────────────────────────────────────────────────────
// Returns the alert type string (e.g. "NOTE") if the paragraph is an alert
// marker, null otherwise.

function getAlertType(para: Paragraph): string | null {
  if (para.children.length === 0) return null;
  const first = para.children[0];
  if (first.type !== "text") return null;
  // The marker must be the entire first line of the text node
  const firstLine = (first as Text).value.split("\n")[0].trim();
  const match = firstLine.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]$/i);
  if (!match) return null;
  return match[1].toUpperCase();
}

// ─── Remark plugin ────────────────────────────────────────────────────────────

const remarkAlerts: Plugin<[], Root> = function () {
  return (tree: Root) => {
    visit(tree, "blockquote", (node: Blockquote) => {
      const firstChild = node.children[0];
      const alertType = firstChild?.type === "paragraph"
        ? getAlertType(firstChild as Paragraph)
        : null;

      if (alertType) {
        const printedName = ALERT_TYPES[alertType];

        // Strip only the marker line; keep any inline nodes (bold, links,
        // code, ...) that follow it in the same paragraph.
        const firstPara = firstChild as Paragraph;
        const firstText = firstPara.children[0] as Text;
        firstText.value = firstText.value.split("\n").slice(1).join("\n").trimStart();
        if (!firstText.value) firstPara.children.shift();
        if (firstPara.children.length === 0) node.children.shift();

        node.children.unshift({
          type: "alertTitle",
          data: {
            hName: "p",
            hProperties: { className: ["alert-title"] },
          },
          children: [{ type: "text", value: printedName }],
        } as any);

        node.data = node.data ?? {};
        node.data.hName = "div";
        node.data.hProperties = {
          className: ["alert", `alert-${alertType.toLowerCase()}`],
        };
      } else {
        // Plain blockquote — render as div with blockquote class so that
        // remark-math and other plugins process the children correctly.
        node.data = node.data ?? {};
        node.data.hName = "div";
        node.data.hProperties = { className: ["blockquote"] };
      }
    });
  };
};

export default remarkAlerts;
