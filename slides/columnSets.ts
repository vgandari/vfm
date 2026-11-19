/**
 * slides/columnSets.ts
 *
 * Bullet sets on a `2col` slide. A blank line between two groups of bullets starts a new set, and the two-column layout
 * may break between sets (a set is never cut). An HTML comment between them is the author's note to themselves: it is
 * transparent, neither joining nor separating, so lists around a comment are one list unless a blank line also sits there.
 *
 * Markdown itself reads `- a`, blank, `- b` as one loose list, and `- a`, comment, `- b` as two lists; neither is what
 * the author of a `2col` slide means, so the blocks are re-cut here before the splitter sees them.
 */

import type { List, ListItem } from "mdast";
import type { Block } from "./types";

type Lined = { position?: { start: { line: number }; end: { line: number } } };

const isComment = (n: { type: string; value?: unknown }) => n.type === "html" && /^\s*<!--[\s\S]*-->\s*$/.test(String(n.value));

const linesOf = (n: Lined) => (n.position ? n.position.end.line - n.position.start.line + 1 : 0);

/** True when a blank line lies between `a` and `b` once the `commentLines` lines of comments between them are set aside. */
function blankBetween(a: Lined, b: Lined, commentLines: number): boolean {
  if (!a.position || !b.position) return false;
  return b.position.start.line - a.position.end.line - 1 - commentLines > 0;
}

/** Cuts every top-level list at its blank lines and joins lists that only a comment separates. Other blocks are untouched. */
export function columnSets(blocks: readonly Block[]): Block[] {
  const out: Block[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const first = blocks[i];
    if (first.type !== "list") {
      out.push(first);
      continue;
    }
    // Gather this list and the lists after it that only comments separate (same kind: bullets or numbers).
    const items: ListItem[] = [];
    const cutBefore = new Set<ListItem>();
    let last: List = first as List;
    items.push(...last.children);
    last.children.forEach((it, k) => {
      if (k > 0 && blankBetween(last.children[k - 1], it, 0)) cutBefore.add(it);
    });
    let j = i + 1;
    for (;;) {
      let k = j;
      let commentLines = 0;
      while (k < blocks.length && isComment(blocks[k] as any)) commentLines += linesOf(blocks[k] as Lined), k++;
      const next = blocks[k];
      if (!next || next.type !== "list" || (next as List).ordered !== last.ordered) break;
      const list = next as List;
      const tail = last.children[last.children.length - 1];
      if (blankBetween(tail, list.children[0], commentLines)) cutBefore.add(list.children[0]);
      list.children.forEach((it, m) => {
        if (m > 0 && blankBetween(list.children[m - 1], it, 0)) cutBefore.add(it);
      });
      items.push(...list.children);
      last = list;
      j = k + 1;
    }
    i = j - 1;
    // Cut into sets. Numbers go on counting through the sets.
    const base = (first as List).start ?? 1;
    let set: ListItem[] = [];
    let from = 0;
    const flush = () => {
      if (set.length === 0) return;
      out.push({ ...(first as List), children: set, spread: false, start: (first as List).ordered ? base + from : null } as List);
      from += set.length;
      set = [];
    };
    for (const it of items) {
      if (cutBefore.has(it)) flush();
      set.push(it);
    }
    flush();
  }
  return out;
}
