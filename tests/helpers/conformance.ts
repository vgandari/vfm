/**
 * Conformance cases from the published suites of the flavors vfm builds on (tests/fixtures/README.md),
 * and a runner that renders each through vfm and compares the normalized HTML.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeHtml } from "./normalizeHtml.ts";

export interface Case {
  id: string;
  suite: string;
  section: string;
  markdown: string;
  html: string;
  html_in_source: boolean;
}

const here = dirname(fileURLToPath(import.meta.url));
export const cases: Case[] = JSON.parse(readFileSync(join(here, "../fixtures/conformance.json"), "utf8"));

/** vfm shows raw HTML as text, so a case that needs it parsed says nothing about vfm (REQ-302). */
export const isRawHtmlCase = (c: Case) => c.section === "HTML blocks" || c.section === "Raw HTML" || c.html_in_source;

export type Render = (markdown: string) => string;

export interface Outcome {
  ok: boolean;
  expected: string;
  actual: string;
}

export function run(c: Case, render: Render): Outcome {
  const expected = normalizeHtml(c.html);
  let actual: string;
  try {
    actual = normalizeHtml(render(c.markdown), { addCodeNewline: true });
  } catch (err) {
    actual = `THROWS ${(err as Error).message}`;
  }
  return { ok: expected === actual, expected, actual };
}

export interface Known {
  kind: "by-design" | "upstream" | "other-suite" | "defect";
  reason: string;
}

const knownFile = JSON.parse(readFileSync(join(here, "../fixtures/known-divergences.json"), "utf8"));
export const known: Record<string, Known> = Object.fromEntries(Object.entries(knownFile).filter(([k]) => !k.startsWith("_"))) as Record<string, Known>;

/**
 * Runs every case `pick` selects (raw-HTML cases are left out) and returns what is wrong: a case that fails and is
 * not in the ledger, and a case that passes while the ledger says it diverges (so the ledger cannot go stale).
 */
export function check(pick: (c: Case) => boolean, render: Render): { ran: number; problems: string[] } {
  const problems: string[] = [];
  let ran = 0;
  for (const c of cases.filter((c) => pick(c) && !isRawHtmlCase(c))) {
    ran++;
    const o = run(c, render);
    const k = known[c.id];
    if (o.ok && k) problems.push(`${c.id} now passes but known-divergences.json lists it as ${k.kind} ("${k.reason}"): remove it`);
    if (!o.ok && !k) {
      problems.push(`${c.id} (${c.suite}, ${c.section}) differs\n  input:    ${JSON.stringify(c.markdown)}\n  expected: ${o.expected.replace(/\n/g, " ")}\n  actual:   ${o.actual.replace(/\n/g, " ")}`);
    }
  }
  return { ran, problems };
}
