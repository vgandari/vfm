/**
 * plugins/cross-refs.ts
 *
 * Remark plugin that resolves [@type:label] cross-reference tokens in text
 * nodes into mdast `link` nodes pointing to the labeled element.
 *
 * Must run after the registry pre-pass (registry.ts), which populates
 * file.data.registry with the label-to-display-text map.
 *
 * Syntax:
 *   [@sec:intro]        → links to id "sec:intro", displays "Section 1.1"
 *   [@fig:diagram]      → links to id "fig:diagram", displays "Figure 1.6.1"
 *   [@eq:sum]           → links to id "eq:sum", displays "Equation 1.1"
 *
 * Cross-component refs (UUID-prefixed, target not yet loaded):
 *   [@UUID-fig:diagram] → placeholder link displaying "[@UUID-fig:diagram]"
 *                         upgrades to "UUID Figure 1.6.1" once target loads
 *
 * Cross-component refs (UUID-prefixed, same component):
 *   [@UUID-fig:diagram] → resolves normally as "Figure 1.6.1" if in registry,
 *                         otherwise placeholder link
 *
 * Static render (id = null):
 *   [@UUID-fig:diagram] → red span if not in registry, raw text otherwise
 *
 * Usage in pipeline.ts:
 *   import remarkCrossRefs from "./plugins/cross-refs";
 *   ...
 *   .use(remarkCrossRefs, { registry, id: options.id })
 */

import type { Plugin } from "unified";
import type { Root, Text, Link, PhrasingContent, Parent } from "mdast";
import { visit, SKIP } from "unist-util-visit";
import type { NormalizedRegistry } from "../registry";

// ─── Cross-reference pattern ──────────────────────────────────────────────────

const XREF_RE = /\[@([^\]:]+:[^\]]+)\]/g;

// ─── UUID extraction ──────────────────────────────────────────────────────────

const UUID_V4_RE =
  /^([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})-/i;

function extractComponentId(label: string): string | null {
  return label.match(UUID_V4_RE)?.[1] ?? null;
}

// ─── Text node splitter
// ───────────────────────────────────────────────────────

function formatUuid(uuid: string): string {
  return uuid;
  // const parts = uuid.split("-");
  // return `[${parts[0]}...${parts[4]}]`;
}

function splitTextNode(
  node: Text,
  registry: NormalizedRegistry,
  currentId: string | null | undefined,
  referencedLabels: Set<string>,
): PhrasingContent[] | null {
  const value = node.value;
  const result: PhrasingContent[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  XREF_RE.lastIndex = 0;
  let found = false;

  while ((match = XREF_RE.exec(value)) !== null) {
    const label = match[1];
    const entry = registry.get(label);

    if (!entry) {
      const targetId = extractComponentId(label);
      const isCrossComponent =
        targetId !== null &&
        targetId.toLowerCase() !== currentId?.toLowerCase();
      const isSameComponent = targetId !== null && !isCrossComponent;

      if ((isCrossComponent || isSameComponent) && currentId !== null) {
        // Client render: UUID-prefixed ref not yet resolved — emit placeholder
        // link that will upgrade on re-render once the target component loads.
        found = true;
        if (match.index > lastIndex) {
          result.push({ type: "text", value: value.slice(lastIndex, match.index) });
        }
        result.push({
          type: "link",
          url: `#${label}`,
          title: null,
          data: { hProperties: { className: ["xref", "xref-unresolved"] } },
          children: [{ type: "text", value: match[0] }],
        } as Link);
        lastIndex = match.index + match[0].length;
      } else if (currentId === null) {
        // Static render: any unresolved ref (UUID-prefixed or plain) — show in red.
        found = true;
        if (match.index > lastIndex) {
          result.push({ type: "text", value: value.slice(lastIndex, match.index) });
        }
        result.push({
          type: "html",
          value: `<span style="color:red">${match[0]}</span>`,
        } as any);
        lastIndex = match.index + match[0].length;
      }

      continue;
    }

    // Entry found — emit a resolved link
    found = true;
    if (match.index > lastIndex) {
      result.push({ type: "text", value: value.slice(lastIndex, match.index) });
    }

    referencedLabels.add(entry.id);

    const targetId = extractComponentId(label);
    const isCrossComponent =
      targetId !== null &&
      targetId.toLowerCase() !== currentId?.toLowerCase();

    // For cross-component refs, prepend the UUID to the display text so the
    // user knows the link targets a different component.
    const displayText = isCrossComponent
      ? `${entry.displayText} (${formatUuid(targetId)})`
      : entry.displayText;

    result.push({
      type: "link",
      url: `#${entry.id}`,
      title: null,
      data: {
        hProperties: {
          className: ["xref", ...(isCrossComponent ? ["xref-cross"] : [])],
        },
      },
      children: [{ type: "text", value: displayText }],
    } as Link);

    lastIndex = match.index + match[0].length;
  }

  if (!found) return null;

  if (lastIndex < value.length) {
    result.push({ type: "text", value: value.slice(lastIndex) });
  }

  return result;
}

// ─── Remark plugin ────────────────────────────────────────────────────────────

interface CrossRefsOptions {
  registry?: NormalizedRegistry;
  id?: string | null;
}

const remarkCrossRefs: Plugin<[CrossRefsOptions?], Root> = function (
  options = {}
) {
  return (tree: Root, file: any) => {
    const registry: NormalizedRegistry | undefined =
      options.registry ?? file.data?.registry;
    if (!registry) {
      console.warn(
        "remarkCrossRefs: no registry found — " +
        "ensure remarkRegistry runs before remarkCrossRefs, or pass registry via options"
      );
      return;
    }

    const currentId = options.id ?? null;

    // Collect labels that are actually linked so suppress-labels.ts can use them.
    const referencedLabels: Set<string> =
      (file.data.referencedLabels as Set<string> | undefined) ?? new Set();
    file.data.referencedLabels = referencedLabels;

    visit(tree, "text", (node: Text, index, parent: Parent | null) => {
      if (!parent || index === undefined) return;

      const replacement = splitTextNode(node, registry, currentId, referencedLabels);
      if (!replacement) return;

      parent.children.splice(index, 1, ...replacement);
      return [SKIP, index + replacement.length];
    });
  };
};

export default remarkCrossRefs;