/**
 * slides/reducer.ts
 *
 * Turns a paragraph in a `@slide` block into slide-sized content (see ../../paragraph-reducer/).
 * It only SELECTS and DELETES: every word on the slide comes from the paragraph, the other
 * sentences are left off, and nothing is paraphrased.
 *
 *   flatten → author override → segment (one sentence per line, see segment.ts)
 *     → kind: process | statistic | list | exposition
 *     → score, pick the top sentences (with topic-shift split for long paragraphs)
 *     → tidy (drop brackets and comma/dash asides, never bold) → mdast blocks
 *
 * This file is language-independent. A language profile (./languages/, English first) adds lead-in
 * words, ordinals, list phrases and anaphoric openers through plain data fields; a language without
 * one gets the language-independent behavior alone.
 * Not implemented: grammar-based trimming (needs a dependency parser), contrast layout, and
 * sentence-splitting abbreviation lists (the newline rule makes them unnecessary).
 *
 * Input is never mutated; results are new nodes carrying the paragraph's position.
 */

import type { Block, Inline } from "./types";
import type { List, ListItem, Paragraph, Root } from "mdast";
import { visit } from "unist-util-visit";
import { CITE_RE_SOURCE } from "../bibliography";
import { XREF_RE } from "./labels";
import { inlineText, segmentSentences } from "./segment";
import { documentLanguage, PROFILES, type LanguageProfile } from "./languages";

export type ParagraphsMode = "auto" | "first-sentence" | "notes-only" | "full";

export const PARAGRAPH_MODES: readonly ParagraphsMode[] = ["auto", "first-sentence", "notes-only", "full"];

// ─── Document statistics (A2) ─────────────────────────────────────────────────

export interface DocStats {
  locale?: string;
  profile?: LanguageProfile;
  idf: (token: string) => number;
  /** Tokens that begin a large share of the document's sentences. */
  frequentOpeners: Set<string>;
  tokens: (text: string) => string[];
}

const segmenters = new Map<string, Intl.Segmenter>();
function wordTokens(text: string, locale?: string): string[] {
  const key = locale ?? "";
  let seg = segmenters.get(key);
  if (!seg) {
    try {
      seg = new Intl.Segmenter(locale, { granularity: "word" });
    } catch {
      seg = new Intl.Segmenter(undefined, { granularity: "word" }); // malformed `lang:`
    }
    segmenters.set(key, seg);
  }
  const out: string[] = [];
  for (const s of seg.segment(text)) if (s.isWordLike) out.push(s.segment.toLowerCase());
  return out;
}

const plain = (nodes: readonly any[]) =>
  inlineText(nodes)
    .replace(new RegExp(CITE_RE_SOURCE, "g"), " ")
    .replace(new RegExp(XREF_RE.source, "g"), " ");

/**
 * Computed over the WHOLE tree, including text outside `@slide` blocks, so the same document scores
 * the same whether it is built as a document or as slides.
 */
export function buildDocStats(tree: Root, declaredLang?: string): DocStats {
  const sentences: string[][] = [];
  visit(tree, "paragraph", (p: Paragraph) => {
    for (const s of segmentSentences(p.children as Inline[])) sentences.push(wordTokens(plain(s), documentLanguage(declaredLang)));
  });
  // English unless the header says otherwise; a language with no profile gets language-independent behavior only.
  const lang = documentLanguage(declaredLang);
  const locale = lang;
  const df = new Map<string, number>();
  const opening = new Map<string, number>();
  for (const toks of sentences) {
    for (const t of new Set(toks)) df.set(t, (df.get(t) ?? 0) + 1);
    if (toks[0]) opening.set(toks[0], (opening.get(toks[0]) ?? 0) + 1);
  }
  const n = sentences.length;
  const frequentOpeners = new Set<string>();
  for (const [t, c] of opening) if (c >= 3 && c / Math.max(1, n) >= 0.02) frequentOpeners.add(t);
  return {
    locale,
    profile: PROFILES[lang],
    idf: (t) => Math.log((n + 1) / ((df.get(t) ?? 0) + 1)) + 1,
    frequentOpeners,
    tokens: (text) => wordTokens(text, locale),
  };
}

// ─── Inline helpers (A1) ──────────────────────────────────────────────────────

type Span = { start: number; end: number };

const hasStrong = (nodes: readonly Inline[]): boolean => {
  let found = false;
  for (const n of nodes) visit(n as any, "strong", () => void (found = true));
  return found;
};

/** True when the paragraph is nothing but bold text. */
function isBoldOnly(children: readonly Inline[]): boolean {
  let bold = false;
  for (const c of children) {
    if (c.type === "strong") bold = true;
    else if (!(c.type === "text" && !c.value.trim()) && c.type !== "break") return false;
  }
  return bold;
}

const maskRe = () => new RegExp(`${CITE_RE_SOURCE}|${XREF_RE.source}`, "g");
const maskOut = (v: string) => v.replace(maskRe(), (m) => "\u0000".repeat(m.length));

function deleteSpans(value: string, spans: Span[]): string {
  let out = "";
  let at = 0;
  for (const s of [...spans].sort((a, b) => a.start - b.start)) {
    if (s.start < at) continue;
    out += value.slice(at, s.start);
    at = s.end;
  }
  return out + value.slice(at);
}

const BRACKETS = /[ \t]*(?:\([^()]*\)|（[^）]*）|【[^】]*】|\[(?![@^])[^\][]*\])/g;
const DASH_ASIDE = /[ \t]+(?:—|–|--)[ \t]*[^—–\n]+?[ \t]*(?:—|–|--)[ \t]+/g;

/**
 * A7: deletions only, in plain text nodes (bold and other inline nodes are never touched).
 * Bracketed text goes. A span between a pair of commas goes only when the sentence has exactly that one
 * pair and the span opens like an aside (language profile: "which…", "including…"), so lists and long
 * clauses stay whole.
 */
export function tidyText(value: string, stats: DocStats): string {
  const masked = maskOut(value);
  const spans: Span[] = [];
  // A span that holds a citation or cross-reference (masked to \u0000) is content, not an aside: it stays.
  for (const m of masked.matchAll(BRACKETS)) if (!m[0].includes("\u0000")) spans.push({ start: m.index!, end: m.index! + m[0].length });
  let out = deleteSpans(value, spans);

  const dashes = [...maskOut(out).matchAll(DASH_ASIDE)].filter((m) => !m[0].includes("\u0000"));
  if (dashes.length > 0) {
    let result = "";
    let at = 0;
    for (const m of dashes) {
      result += out.slice(at, m.index) + " ";
      at = m.index! + m[0].length;
    }
    out = result + out.slice(at);
  }

  // A span between a pair of commas is an aside only when the language says it opens like one
  // ("which ran…", "including…"). Without a parser, cutting any span between commas would break lists
  // and long clauses; digit separators ("2,008,000") are not commas here either.
  const openers = stats.profile?.asideOpeners ?? [];
  if (openers.length > 0) {
    const m2 = maskOut(out);
    const commas = [...m2.matchAll(/(?<!\d),|,(?!\d)|\uFF0C/g)];
    if (commas.length === 2) {
      const a = commas[0].index!;
      const b = commas[1].index!;
      const span = out.slice(a + 1, b).trim().toLowerCase();
      if (!m2.slice(a, b).includes("\u0000") && stats.tokens(span).length >= 3 && a > 0 && b < out.length - 1 && openers.some((w) => span === w || span.startsWith(w + " "))) {
        out = out.slice(0, a) + out.slice(b + 1);
      }
    }
  }
  return out;
}

/** Tidies every top-level text node, then repairs spacing around the cuts. */
function tidyInline(children: Inline[], stats: DocStats): Inline[] {
  // Asides can span text nodes only through other inline nodes, which we never delete.
  const out: Inline[] = children.map((c) => (c.type === "text" ? { ...c, value: tidyText(c.value, stats) } : c));
  return fixSpacing(out);
}

function fixSpacing(nodes: Inline[]): Inline[] {
  const out: Inline[] = [];
  for (const n of nodes) {
    if (n.type === "text") {
      const value = n.value.replace(/\s*\n\s*/g, " ").replace(/[ \t]{2,}/g, " ").replace(/[ \t]+([.,;:!?…。！？])/g, "$1");
      if (value) out.push({ ...n, value });
    } else out.push(n);
  }
  const first = out[0];
  if (first?.type === "text") first.value = first.value.replace(/^\s+/, "");
  const last = out[out.length - 1];
  if (last?.type === "text") last.value = last.value.replace(/\s+$/, "");
  return out.filter((n) => !(n.type === "text" && n.value === ""));
}

const capitalizeFirst = (nodes: Inline[]): Inline[] => {
  const first = nodes[0];
  if (first?.type !== "text") return nodes;
  return [{ ...first, value: first.value.replace(/^(\P{L}*)(\p{Ll})/u, (_, p, c) => p + c.toUpperCase()) }, ...nodes.slice(1)];
};

/** Strips a leading phrase (one of `words`) plus the comma or colon after it from the first text node. */
function stripLeading(nodes: Inline[], words: string[], capitalize = true): { nodes: Inline[]; hit?: string } {
  const first = nodes[0];
  if (first?.type !== "text") return { nodes };
  const lower = first.value.toLowerCase();
  for (const w of [...words].sort((a, b) => b.length - a.length)) {
    if (!lower.startsWith(w)) continue;
    const after = first.value.slice(w.length);
    if (!/^[\s,:;—-]/.test(after) && after !== "") continue;
    const rest = after.replace(/^[\s,:;—-]+/, "");
    const next = rest ? [{ ...first, value: rest }, ...nodes.slice(1)] : nodes.slice(1);
    if (next.length === 0) return { nodes };
    return { nodes: capitalize ? capitalizeFirst(next as Inline[]) : (next as Inline[]), hit: w };
  }
  return { nodes };
}


// ─── The meat of a sentence ───────────────────────────────────────────────────

/**
 * "While A, B." / "Despite A, B." → "B." — the main clause is what deserves the bullet. Language-
 * independent mechanism, driven by the profile's `backgroundOpeners`. It cuts at the first comma, and
 * leaves the sentence whole when that is a risk: the part to be dropped holds bold text or another
 * inline node, the cut would leave too little, or the next comma is close behind (a list such as
 * "While A, B, and C all grew, D fell", where the first comma is not the clause boundary).
 */
export function extractMeat(nodes: Inline[], stats: DocStats): Inline[] {
  const openers = stats.profile?.backgroundOpeners ?? [];
  const first = nodes[0];
  if (openers.length === 0 || first?.type !== "text") return nodes;
  const lower = first.value.toLowerCase();
  const opener = [...openers].sort((a, b) => b.length - a.length).find((w) => lower.startsWith(w) && !/\p{L}/u.test(lower[w.length] ?? " "));
  if (!opener) return nodes;
  // The boundary is the first comma in a text node. Italics, links and the like before it are cut with
  // the rest, but bold text is never removed, so a bold word in the opening part keeps the sentence whole.
  const boundary = /(?<!\d),(?!\d)|\uFF0C/g;
  let k = -1;
  let at = -1;
  let next = -1;
  for (let i = 0; i < nodes.length && k < 0; i++) {
    const n = nodes[i];
    if (n.type === "strong") return nodes;
    if (n.type !== "text") continue;
    const commas = [...maskOut(n.value).matchAll(boundary)];
    if (commas.length > 0) {
      k = i;
      at = commas[0].index!;
      next = commas[1]?.index ?? -1;
    }
  }
  if (k < 0) return nodes;
  const node = nodes[k] as { type: "text"; value: string };
  const cutPart = [...nodes.slice(0, k), { type: "text", value: node.value.slice(0, at) }] as Inline[];
  // A citation or cross-reference in the part to be cut is kept: the sentence stays whole.
  if (maskOut(inlineText(cutPart)).includes("\u0000")) return nodes;
  const head = plain(cutPart);
  if (stats.tokens(head.slice(opener.length)).length < 1) return nodes;
  const rest = node.value.slice(at + 1).replace(/^\s+/, "");
  const tail: Inline[] = rest ? [{ ...node, value: rest }, ...nodes.slice(k + 1)] : nodes.slice(k + 1);
  if (tail.length === 0) return nodes;
  // A second comma soon after the first suggests a list inside the background clause.
  if (next >= 0 && stats.tokens(node.value.slice(at + 1, next)).length < 3 && next - at < 40) return nodes;
  if (stats.tokens(plain(tail)).length < 4) return nodes;
  return capitalizeFirst(tail);
}

// ─── Kinds (A4) ───────────────────────────────────────────────────────────────

const NUMERIC_LEADER = /^\s*(\d+)[.):：]\s*/;
const COLON = /[:：]/;
const DELIMS = /[,;，；、]/;
const VALUE_RE = /(?:[$€£¥₹]\s?\d[\d,.]*\s?(?:[kKmMbB]\b|million|billion)?|\d[\d,.]*\s?(?:%|‰|¢))/g;

/** Splits inline nodes at top-level delimiters in text nodes, starting at `from` (node index, char). */
function splitItems(nodes: Inline[], at: { node: number; char: number }): Inline[][] {
  const items: Inline[][] = [[]];
  nodes.forEach((n, i) => {
    if (i < at.node) return;
    if (n.type !== "text") {
      items[items.length - 1].push(n);
      return;
    }
    let value = i === at.node ? n.value.slice(at.char) : n.value;
    let from = 0;
    const masked = maskOut(value);
    for (const m of masked.matchAll(new RegExp(DELIMS.source, "g"))) {
      items[items.length - 1].push({ type: "text", value: value.slice(from, m.index) });
      items.push([]);
      from = m.index! + 1;
    }
    value = value.slice(from);
    items[items.length - 1].push({ type: "text", value });
  });
  return items;
}

function trimNodes(nodes: Inline[]): Inline[] {
  return fixSpacing(nodes.map((n) => ({ ...n }) as Inline));
}

/** "Intro: a, b, and c." → the intro (with its colon or list phrase) and [a, b, c]; null when it is not a list. */
function detectEnumeration(nodes: Inline[], stats: DocStats): { intro: Inline[]; items: Inline[][] } | null {
  const profile = stats.profile;
  let at: { node: number; char: number } | undefined;
  const consider = (node: number, char: number) => {
    if (!at || node < at.node || (node === at.node && char < at.char)) at = { node, char };
  };
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (n.type !== "text") continue;
    const masked = maskOut(n.value);
    const c = COLON.exec(masked);
    if (c) consider(i, c.index + 1);
    for (const phrase of profile?.listPhrases ?? []) {
      const m = new RegExp(`\\b${phrase}\\b`, "i").exec(masked);
      if (m) consider(i, m.index + m[0].length);
    }
    if (at) break;
  }
  if (!at) return null;
  const raw = splitItems(nodes, at).map(trimNodes).filter((x) => x.length > 0);
  if (raw.length < 3) return null;
  const items = raw.map((it, i) => {
    let item = it;
    if (i > 0 && profile) item = stripLeading(item, profile.conjunctions, false).nodes;
    if (i === raw.length - 1) {
      item = item.map((n, k) => (k === item.length - 1 && n.type === "text" ? { ...n, value: n.value.replace(/[.!?\u3002\uFF01\uFF1F\u2026]+\s*$/, "") } : n));
    }
    return trimNodes(item);
  });
  const lengths = items.map((i) => inlineText(i).length);
  if (items.some((i) => i.length === 0) || Math.max(...lengths) > 60) return null;
  // The intro keeps its colon (or "include"): it is the parent bullet, so the list keeps its context.
  const head = nodes.slice(0, at.node);
  const split = nodes[at.node];
  if (split.type === "text") head.push({ ...split, value: split.value.slice(0, at.char) });
  return { intro: trimNodes(head), items };
}

function detectStatistic(nodes: Inline[], stats: DocStats): { value: Inline[]; caption: Inline[] } | null {
  const text = plain(nodes);
  const found = [...text.matchAll(VALUE_RE)];
  if (found.length !== 1) return null;
  if (stats.tokens(text).length > 30) return null;
  // The value must sit in one text node (or inside bold) so it can be shown on its own.
  const hit = found[0][0].trim();
  const idx = nodes.findIndex((n) => (n.type === "text" || n.type === "strong") && inlineText([n]).includes(hit));
  if (idx < 0) return null;
  const node = nodes[idx];
  const leaders = stats.profile?.numberLeaders ?? [];
  const leader = leaders.length ? new RegExp(`\\b(?:${leaders.join("|")})\\s*$`, "i") : undefined;
  // The caption is the sentence with the value cut out only when a word like "to" or "at" leads it
  // ("fell to 4.2% in Q3" → "fell in Q3"). Otherwise cutting would break the sentence, so it stays whole.
  const whole = fixSpacing(nodes.map((n) => ({ ...n }) as Inline));
  const value: Inline[] = [{ type: "text", value: hit }];
  const before = nodes.slice(0, idx);
  const lead = before[before.length - 1];
  if (node.type === "strong") {
    if (lead?.type === "text" && leader?.test(lead.value)) {
      const cut = [...before.slice(0, -1), { ...lead, value: lead.value.replace(leader, "").replace(/\s+$/, "") }, ...nodes.slice(idx + 1)];
      return { value, caption: fixSpacing(cut as Inline[]) };
    }
    return { value, caption: whole };
  }
  const v = (node as { value: string }).value;
  const p = v.indexOf(hit);
  const head = v.slice(0, p);
  if (leader?.test(head)) {
    const caption: Inline[] = [...before, { type: "text", value: head.replace(leader, "").replace(/\s+$/, "") + v.slice(p + hit.length) }, ...nodes.slice(idx + 1)];
    return { value, caption: fixSpacing(caption.map((n) => ({ ...n }) as Inline)) };
  }
  return { value, caption: whole };
}

function detectProcess(sentences: Inline[][], stats: DocStats): Inline[][] | null {
  if (sentences.length < 2) return null;
  const ordinals = stats.profile?.ordinals ?? [];
  const stripped: Inline[][] = [];
  let byNumber = true;
  let byWord = ordinals.length > 0;
  for (const s of sentences) {
    const first = s[0];
    if (first?.type !== "text") return null;
    const num = NUMERIC_LEADER.exec(first.value);
    if (!num) byNumber = false;
    const word = ordinals.find((o) => new RegExp(`^${o}\\b`, "i").test(first.value.trim()));
    if (!word) byWord = false;
    if (!byNumber && !byWord) return null;
    if (byNumber && num) stripped.push(capitalizeFirst([{ ...first, value: first.value.slice(num[0].length) }, ...s.slice(1)] as Inline[]));
    else if (word) stripped.push(stripLeading(s, [word]).nodes);
  }
  return stripped;
}

// ─── Scoring and selection (A5, A6) ───────────────────────────────────────────

interface Scored {
  nodes: Inline[];
  score: number;
}

const W = { first: 2, last: 0.8, bold: 2, heading: 1.5, number: 1, filler: -1 };

function openerOf(nodes: Inline[], stats: DocStats): string | undefined {
  return stats.tokens(plain(nodes))[0];
}

function scoreSentences(sentences: Inline[][], head: string[], stats: DocStats): number[] {
  const headSet = new Set(head);
  const headWeight = [...headSet].reduce((a, t) => a + stats.idf(t), 0) || 1;
  const leadIns = new Set((stats.profile?.leadIns ?? []).map((l) => l.split(" ")[0]));
  return sentences.map((s, i) => {
    const toks = stats.tokens(plain(s));
    let sc = 0;
    if (i === 0) sc += W.first;
    else if (i === sentences.length - 1) sc += W.last;
    if (hasStrong(s)) sc += W.bold;
    sc += (W.heading * [...new Set(toks)].filter((t) => headSet.has(t)).reduce((a, t) => a + stats.idf(t), 0)) / headWeight;
    if (/\p{N}/u.test(plain(s))) sc += W.number;
    const op = toks[0];
    if (op && (stats.frequentOpeners.has(op) || leadIns.has(op))) sc += W.filler;
    return sc;
  });
}

/** IDF-weighted cosine similarity of the token sets of two sentence windows. */
function similarity(a: string[], b: string[], stats: DocStats): number {
  const A = new Set(a);
  const B = new Set(b);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const t of A) {
    const w = stats.idf(t) ** 2;
    na += w;
    if (B.has(t)) dot += w;
  }
  for (const t of B) nb += stats.idf(t) ** 2;
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/** Splits a long paragraph (6+ sentences) where adjacent windows are least alike. */
function topicGroups(sentences: Inline[][], stats: DocStats): Inline[][][] {
  if (sentences.length < 6) return [sentences];
  const toks = sentences.map((s) => stats.tokens(plain(s)));
  let best = -1;
  let bestSim = Infinity;
  const mid = sentences.length / 2;
  for (let i = 2; i <= sentences.length - 2; i++) {
    const left = toks.slice(Math.max(0, i - 2), i).flat();
    const right = toks.slice(i, i + 2).flat();
    const sim = similarity(left, right, stats);
    if (sim < bestSim - 1e-9 || (Math.abs(sim - bestSim) < 1e-9 && Math.abs(i - mid) < Math.abs(best - mid))) {
      best = i;
      bestSim = sim;
    }
  }
  return [...topicGroups(sentences.slice(0, best), stats), ...topicGroups(sentences.slice(best), stats)];
}

function pick(group: Inline[][], head: string[], stats: DocStats, k: number): Inline[][] {
  const scores = scoreSentences(group, head, stats);
  const order = group.map((_, i) => i).sort((a, b) => scores[b] - scores[a] || a - b);
  const chosen = new Set(order.slice(0, k));
  // A chosen sentence that points back ("This", "It") brings the sentence before it.
  const anaphora = new Set(stats.profile?.anaphora ?? []);
  for (const i of [...chosen]) {
    const op = openerOf(group[i], stats);
    if (i > 0 && op && anaphora.has(op) && !chosen.has(i - 1)) chosen.add(i - 1);
  }
  return group.filter((_, i) => chosen.has(i));
}

// ─── Public entry ─────────────────────────────────────────────────────────────

export interface ReduceContext {
  stats: DocStats;
  mode: ParagraphsMode;
  /** Slide title or section heading, as plain text. */
  headingText: string;
  /** Sentences kept per paragraph (per topic group). */
  keep?: number;
}

/** One bullet, optionally with a nested list of plain items. */
interface Bullet {
  inline: Inline[];
  sub?: Inline[][];
}

const item = (b: Bullet, pos: Paragraph["position"]): ListItem => ({
  type: "listItem",
  spread: false,
  checked: null,
  children: [
    { type: "paragraph", children: b.inline, position: pos },
    ...(b.sub ? [list(false, b.sub.map((inline) => ({ inline })), pos)] : []),
  ],
  position: pos,
});

const list = (ordered: boolean, items: Bullet[], pos: Paragraph["position"]): List => ({
  type: "list",
  ordered,
  start: ordered ? 1 : null,
  spread: false,
  children: items.map((b) => item(b, pos)),
  position: pos,
});

/** A value shown large with a caption. Its own node type, so the HTML comes from data.hName, not the paragraph handler. */
const callout = (value: Inline[], caption: Inline[], pos: Paragraph["position"]): Block =>
  ({
    type: "vfmCallout",
    data: { hName: "div", hProperties: { className: ["vfm-callout"] } },
    position: pos,
    children: [
      { type: "strong", data: { hName: "span", hProperties: { className: ["vfm-callout-value"] } }, children: value },
      { type: "emphasis", data: { hName: "span", hProperties: { className: ["vfm-callout-caption"] } }, children: caption },
    ],
  }) as unknown as Block;

/**
 * The blocks that stand in for `para` on a slide, or null to keep the paragraph as written
 * (mode "full"). An empty array means the paragraph is left off.
 */
export function reduceParagraph(para: Paragraph, ctx: ReduceContext): Block[] | null {
  const { stats, mode } = ctx;
  if (mode === "full") return null;
  if (mode === "notes-only") return [];
  try {
    const pos = para.position;
    const children = para.children as Inline[];

    // A10: a paragraph that is only bold is the author's own slide text.
    if (isBoldOnly(children)) return [list(false, [{ inline: children.filter((c) => c.type !== "break") }], pos)];

    let sentences = segmentSentences(children).map((s) => fixSpacing(s));
    sentences = sentences.filter((s) => s.length > 0);
    if (sentences.length === 0) return [];

    if (mode === "first-sentence") {
      const first = tidyInline(sentences[0], stats);
      return first.length ? [list(false, [{ inline: first }], pos)] : [];
    }

    const process = detectProcess(sentences, stats);
    if (process) return [list(true, process.map((s) => ({ inline: tidyInline(s, stats) })).filter((b) => b.inline.length), pos)];

    if (sentences.length === 1) {
      const stat = detectStatistic(sentences[0], stats);
      if (stat && stat.caption.length > 0) return [callout(stat.value, stat.caption, pos)];
    }

    const head = stats.tokens(ctx.headingText);
    const keep = ctx.keep ?? 2;
    const bullets: Bullet[] = [];
    for (const group of topicGroups(sentences, stats)) {
      for (let sentence of pick(group, head, stats, keep)) {
        const enumeration = detectEnumeration(sentence, stats);
        if (enumeration) {
          bullets.push({ inline: tidyInline(enumeration.intro, stats), sub: enumeration.items });
          continue;
        }
        if (stats.profile) sentence = stripLeading(sentence, stats.profile.leadIns).nodes;
        sentence = extractMeat(sentence, stats);
        const tidy = tidyInline(sentence, stats);
        if (tidy.length) bullets.push({ inline: tidy });
      }
    }
    return bullets.length ? [list(false, bullets, pos)] : [];
  } catch {
    // Never throw on valid input: fall back to leaving the paragraph off the slide.
    return [];
  }
}
