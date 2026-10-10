/**
 * registry.ts
 * (unchanged except where marked ← ADDED / ← CHANGED)
 */

import type { Root, RootContent, Heading, Image, Table, Code } from "mdast";
import type { FencedDivNode, EnvType } from "./plugins/fenced-divs";
import type { EquationLabelData } from "./plugins/equation-labels";
import type { AlgorithmBlockNode } from "./plugins/algorithm-blocks";
import type { MusicBlockNode } from "./plugins/music-blocks";  // ← ADDED

export interface RegistryEntry {
  displayText: string;
  printedName: string;
  id: string;
}

export type Registry = Map<string, RegistryEntry>;

export function normalizeKey(key: string): string {
  return key.toLowerCase();
}

export class NormalizedRegistry {
  private map = new Map<string, RegistryEntry>();
  set(key: string, value: RegistryEntry): void {
    this.map.set(normalizeKey(key), value);
  }
  get(key: string): RegistryEntry | undefined {
    return this.map.get(normalizeKey(key));
  }
  has(key: string): boolean {
    return this.map.has(normalizeKey(key));
  }
  keys(): IterableIterator<string> {
    return this.map.keys();
  }
}

export interface RegistryOptions {
  /**
   * Heading depth that prefixes figure/table/listing/equation numbers.
   * 0 turns heading numbering off: headings get no number, items are numbered
   * globally ("Figure 1"), and section cross-references show the heading text.
   */
  numberingDepth: number;
  suppressUnreferencedLabels?: boolean;
}

const XREF_SCAN_RE = /\[@([^\]:]+:[^\]]+)\]/g;

function headingText(node: any): string {
  if (typeof node.value === "string") return node.value;
  if (Array.isArray(node.children)) return node.children.map(headingText).join("");
  return "";
}

function collectXrefLabels(source: string): Set<string> {
  const labels = new Set<string>();
  let m: RegExpExecArray | null;
  XREF_SCAN_RE.lastIndex = 0;
  while ((m = XREF_SCAN_RE.exec(source)) !== null) {
    labels.add(m[1].toLowerCase());
  }
  return labels;
}

function indexToLetters(index: number): string {
  let result = "";
  let i = index;
  do {
    result = String.fromCharCode(97 + (i % 26)) + result;
    i = Math.floor(i / 26) - 1;
  } while (i >= 0);
  return result;
}

function buildSectionPrefix(
  sectionCounters: number[],
  effectiveDepth: number
): string {
  if (effectiveDepth === 0) return "";
  const levels = sectionCounters.slice(0, effectiveDepth);
  let end = levels.length;
  while (end > 0 && levels[end - 1] === 0) end--;
  if (end === 0) return "";
  return levels.slice(0, end).join(".") + ".";
}

const ELEMENT_PRINTED_NAMES: Record<string, string> = {
  fig: "Figure",
  tab: "Table",
  lst: "Listing",
  eq: "Equation",
  alg: "Algorithm",
  mus: "Score",       // ← ADDED
  sec: "Section",
  theorem: "Theorem",
  lemma: "Lemma",
  corollary: "Corollary",
  proposition: "Proposition",
  conjecture: "Conjecture",
  definition: "Definition",
  example: "Example",
  exercise: "Exercise",
  hypothesis: "Hypothesis",
};

type ItemCounters = {
  fig: number;
  tab: number;
  lst: number;
  eq: number;
  alg: number;
  mus: number;        // ← ADDED
  theorem: number;
  lemma: number;
  corollary: number;
  proposition: number;
  conjecture: number;
  definition: number;
  example: number;
  exercise: number;
  hypothesis: number;
};

function makeItemCounters(): ItemCounters {
  return {
    fig: 0,
    tab: 0,
    lst: 0,
    eq: 0,
    alg: 0,
    mus: 0,             // ← ADDED
    theorem: 0,
    lemma: 0,
    corollary: 0,
    proposition: 0,
    conjecture: 0,
    definition: 0,
    example: 0,
    exercise: 0,
    hypothesis: 0,
  };
}

function resetItemCounters(counters: ItemCounters): void {
  (Object.keys(counters) as (keyof ItemCounters)[]).forEach((k) => {
    counters[k] = 0;
  });
}

export function buildRegistry(
  tree: Root,
  options: RegistryOptions,
  source?: string,
): NormalizedRegistry {
  const { numberingDepth, suppressUnreferencedLabels = false } = options;
  const registry = new NormalizedRegistry();

  const xrefLabels: Set<string> = suppressUnreferencedLabels && source
    ? collectXrefLabels(source)
    : new Set();

  function isVisible(label: string | null | undefined, caption: string | null | undefined): boolean {
    if (!suppressUnreferencedLabels) return true;
    if (caption && caption.trim().length > 0) return true;
    if (label && xrefLabels.has(label.toLowerCase())) return true;
    return false;
  }

  let maxHeadingDepth = 0;
  function scanHeadingDepths(nodes: RootContent[]): void {
    for (const node of nodes) {
      if (node.type === "heading") {
        maxHeadingDepth = Math.max(maxHeadingDepth, (node as Heading).depth);
      } else if (node.type !== "fencedDiv" && "children" in node) {
        scanHeadingDepths((node as any).children);
      }
    }
  }
  scanHeadingDepths(tree.children);
  const effectiveDepth = Math.min(numberingDepth, maxHeadingDepth);
  const numberHeadings = numberingDepth > 0;

  const sectionCounters: number[] = Array(6).fill(0);
  const itemCounters = makeItemCounters();

  function walk(nodes: RootContent[], insideFencedDiv: boolean): void {
    for (const node of nodes) {
      if (node.type === "heading" && !insideFencedDiv) {
        processHeading(node as Heading);
      } else if (node.type === "shiftedHeading") {
        const data = (node as any).data as any;
        const label = data?.label;
        if (label) {
          registry.set(label, { displayText: label, printedName: "", id: label });
        }
      } else if (node.type === "image") {
        processImage(node as Image);
      } else if (node.type === "table") {
        processTable(node as Table);
      } else if (node.type === "code") {
        processCode(node as Code);
      } else if (node.type === "math") {
        processMath(node as any);
      } else if (node.type === "algorithmBlock") {
        processAlgorithmBlock(node as unknown as AlgorithmBlockNode);
      } else if (node.type === "musicBlock") {                              // ← ADDED
        processMusicBlock(node as unknown as MusicBlockNode);               // ← ADDED
      } else if (node.type === "fencedDiv") {
        processFencedDiv(node as unknown as FencedDivNode);
      } else if ("children" in node && Array.isArray((node as any).children)) {
        walk((node as any).children, insideFencedDiv);
      }
    }
  }

  function processHeading(node: Heading): void {
    const depth = node.depth;
    const idx = depth - 1;
    sectionCounters[idx] = (sectionCounters[idx] ?? 0) + 1;
    for (let i = idx + 1; i < 6; i++) sectionCounters[i] = 0;
    // With depth 0 items are numbered globally, so counters never reset.
    if (effectiveDepth > 0 && depth <= effectiveDepth) resetItemCounters(itemCounters);
    node.data = node.data ?? {};
    const label = (node.data as any).label;
    if (!numberHeadings) {
      if (label) {
        const displayText = headingText(node).trim() || label;
        registry.set(label, { displayText, printedName: "Section", id: label });
      }
      return;
    }
    const prefix = sectionCounters.slice(0, depth).join(".");
    (node.data as any).displayNumber = prefix;
    if (label) {
      registry.set(label, { displayText: `Section ${prefix}`, printedName: "Section", id: label });
    }
  }

  function processImage(node: Image): void {
    const data = node.data as any;
    if (!data || data.labelType !== "fig") return;
    if (!isVisible(data.label, data.caption)) return;
    itemCounters.fig += 1;
    const prefix = buildSectionPrefix(sectionCounters, effectiveDepth);
    const displayText = `Figure ${prefix}${itemCounters.fig}`;
    if (data.label) registry.set(data.label, { displayText, printedName: "Figure", id: data.label });
    data.displayNumber = `${prefix}${itemCounters.fig}`;
    data.displayText = displayText;
  }

  function processTable(node: Table): void {
    const data = node.data as any;
    if (!data || data.labelType !== "tab") return;
    if (!isVisible(data.label, data.caption)) return;
    itemCounters.tab += 1;
    const prefix = buildSectionPrefix(sectionCounters, effectiveDepth);
    const displayText = `Table ${prefix}${itemCounters.tab}`;
    if (data.label) registry.set(data.label, { displayText, printedName: "Table", id: data.label });
    data.displayNumber = `${prefix}${itemCounters.tab}`;
    data.displayText = displayText;
  }

  function processCode(node: Code): void {
    if (node.lang && (
      node.lang.startsWith("__fenced-div-") ||
      node.lang.startsWith("__algorithm-block-") ||
      node.lang.startsWith("__music-block-")   // ← ADDED
    )) return;
    const data = node.data as any;
    if (!data || data.labelType !== "lst") return;
    if (!isVisible(data.label, data.caption)) return;
    itemCounters.lst += 1;
    const prefix = buildSectionPrefix(sectionCounters, effectiveDepth);
    const displayText = `Listing ${prefix}${itemCounters.lst}`;
    if (data.label) registry.set(data.label, { displayText, printedName: "Listing", id: data.label });
    data.displayNumber = `${prefix}${itemCounters.lst}`;
    data.displayText = displayText;
  }

  function processMath(node: any): void {
    const data = node.data as EquationLabelData & {
      displayNumber?: string;
      displayText?: string;
      lineDisplayNumbers?: Record<string, string>;
    };
    if (!data) return;
    const hasBlockLabel = !!data.blockLabel;
    const hasLineLabels = data.lineLabels && data.lineLabels.length > 0;
    if (!hasBlockLabel && !hasLineLabels) return;
    itemCounters.eq += 1;
    const prefix = buildSectionPrefix(sectionCounters, effectiveDepth);
    const baseNumber = `${prefix}${itemCounters.eq}`;
    if (hasBlockLabel && data.blockLabel) {
      const displayText = `Equation ${baseNumber}`;
      registry.set(data.blockLabel, { displayText, printedName: "Equation", id: data.blockLabel });
      data.displayNumber = baseNumber;
      data.displayText = displayText;
    }
    if (hasLineLabels && data.lineLabels) {
      data.lineDisplayNumbers = {};
      data.lineLabels.forEach((ll, letterIndex) => {
        const letters = indexToLetters(letterIndex);
        const subNumber = `${baseNumber}${letters}`;
        const displayText = `Equation ${subNumber}`;
        registry.set(ll.label, { displayText, printedName: "Equation", id: ll.label });
        data.lineDisplayNumbers![ll.label] = subNumber;
      });
      if (!hasBlockLabel) data.displayNumber = baseNumber;
    }
  }

  function processAlgorithmBlock(node: AlgorithmBlockNode): void {
    if (!isVisible(node.label, node.caption)) return;
    itemCounters.alg += 1;
    const prefix = buildSectionPrefix(sectionCounters, effectiveDepth);
    const displayText = `Algorithm ${prefix}${itemCounters.alg}`;
    if (node.label) registry.set(node.label, { displayText, printedName: "Algorithm", id: node.label });
    node.displayNumber = `${prefix}${itemCounters.alg}`;
    node.displayText = displayText;
  }

  // ← ADDED
  function processMusicBlock(node: MusicBlockNode): void {
    if (!isVisible(node.label, node.caption)) return;
    itemCounters.mus += 1;
    const prefix = buildSectionPrefix(sectionCounters, effectiveDepth);
    const displayText = `Score ${prefix}${itemCounters.mus}`;
    if (node.label) registry.set(node.label, { displayText, printedName: "Score", id: node.label });
    node.displayNumber = `${prefix}${itemCounters.mus}`;
    node.displayText = displayText;
  }

  function processFencedDiv(node: FencedDivNode): void {
    const envType = node.envType as keyof ItemCounters;
    if (!(envType in itemCounters)) return;
    if (!isVisible(node.label, node.name)) return;
    itemCounters[envType] += 1;
    const prefix = buildSectionPrefix(sectionCounters, effectiveDepth);
    const printedName =
      ELEMENT_PRINTED_NAMES[envType] ??
      envType.charAt(0).toUpperCase() + envType.slice(1);
    const displayText = `${printedName} ${prefix}${itemCounters[envType]}`;
    if (node.label) registry.set(node.label, { displayText, printedName, id: node.label });
    (node as any).displayNumber = `${prefix}${itemCounters[envType]}`;
    (node as any).displayText = displayText;
    walk(node.children, true);
  }

  walk(tree.children, false);
  return registry;
}
