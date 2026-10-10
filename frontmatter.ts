/**
 * frontmatter.ts
 *
 * Splits a YAML metadata header off the front of a Markdown source string and
 * parses it. Runs before every other raw-source preprocessor so that labels,
 * cross-references and fenced blocks are never rewritten inside the header.
 *
 * Syntax (YAML only, start of file only):
 *
 *   ---
 *   title: My Document
 *   ---
 *
 *   - The opening `---` must be the first line (an optional BOM is allowed).
 *   - The closing fence is `---`.
 *   - As in Pandoc, the line after the opening fence must not be blank, so a
 *     file that starts with a horizontal rule is not mistaken for a header.
 *   - YAML 1.2 core schema (via `yaml`): `yes`/`no` are strings and
 *     `2026-10-05` stays a string rather than becoming a Date.
 *   - Invalid YAML, or a header that is not a mapping, throws FrontmatterError.
 *
 * Recognised keys (everything else is kept untouched in `data`):
 *
 *   title         string
 *   subtitle      string
 *   abstract      string
 *   date          string
 *   tags          list of strings, or a comma-separated string; a leading "#"
 *                 is dropped (Obsidian style)
 *   bibliography  file name or list of file names (not resolved here)
 *   author(s)     string | list of strings | list of objects:
 *                   name: string | {given, family}
 *                   affiliation(s): string | object | list of either; a string
 *                     is looked up by id (then name) in the top-level
 *                     `affiliations` list, otherwise used as the name
 *                   email, orcid, url, corresponding
 *   affiliations  list of {id, name, department, city, region, country, url}
 */

import { parse, YAMLParseError } from "yaml";

// ─── Public types ─────────────────────────────────────────────────────────────

export interface Affiliation {
  id?: string;
  name: string;
  department?: string;
  city?: string;
  region?: string;
  country?: string;
  url?: string;
}

export interface Author {
  name: string;
  affiliations: Affiliation[];
  email?: string;
  orcid?: string;
  url?: string;
  corresponding?: boolean;
}

export interface FrontmatterMeta {
  title?: string;
  subtitle?: string;
  abstract?: string;
  date?: string;
  tags: string[];
  bibliography: string[];
  authors: Author[];
}

export interface ParsedFrontmatter {
  /** The source with the header removed (unchanged if there was none). */
  content: string;
  /** The raw parsed mapping, including keys with no typed meaning. */
  data: Record<string, unknown>;
  /** Normalised view of the recognised keys. */
  meta: FrontmatterMeta;
}

export class FrontmatterError extends Error {
  /** 1-based line in the source file, when known. */
  readonly line?: number;

  constructor(message: string, line?: number) {
    super(line ? `Invalid frontmatter (line ${line}): ${message}` : `Invalid frontmatter: ${message}`);
    this.name = "FrontmatterError";
    this.line = line;
  }
}

// ─── Splitting ────────────────────────────────────────────────────────────────

// Group 1 is the header body. It is a lazy optional group so an empty header
// ("---\n---") closes at the first fence instead of swallowing later `---`s.
const FRONTMATTER_RE =
  /^\uFEFF?---[ \t]*\r?\n(?![ \t]*(?:\r?\n|$))((?:[\s\S]*?\r?\n)??)---[ \t]*(?:\r?\n|$)/;

// ─── Normalisation helpers ────────────────────────────────────────────────────

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function toArray(v: unknown): unknown[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

function str(v: unknown): string | undefined {
  if (typeof v === "number") return String(v);
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  return s === "" ? undefined : s;
}

function normalizeDate(v: unknown): string | undefined {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? undefined : v.toISOString();
  return str(v);
}

function normalizeTags(v: unknown): string[] {
  const items = typeof v === "string" ? v.split(",") : toArray(v);
  const tags = items
    .map((t) => str(t)?.replace(/^#/, ""))
    .filter((t): t is string => !!t);
  return [...new Set(tags)];
}

function normalizeStringList(v: unknown): string[] {
  return toArray(v)
    .map(str)
    .filter((s): s is string => !!s);
}

function normalizeAffiliation(
  v: unknown,
  byKey: Map<string, Affiliation>
): Affiliation | undefined {
  if (typeof v === "string" || typeof v === "number") {
    const key = str(v);
    return key ? byKey.get(key) ?? { name: key } : undefined;
  }
  if (!isObj(v)) return undefined;

  // Quarto: { ref: a1 } points at a top-level affiliation id.
  const ref = str(v.ref);
  if (ref && byKey.has(ref)) return byKey.get(ref);

  const name = str(v.name) ?? str(v.department);
  if (!name) return undefined;
  const aff: Affiliation = { name };
  for (const key of ["id", "department", "city", "region", "country", "url"] as const) {
    const value = str(v[key]);
    if (value) aff[key] = value;
  }
  return aff;
}

function normalizeAuthorName(v: unknown): string | undefined {
  if (isObj(v)) {
    const literal = str(v.literal);
    if (literal) return literal;
    return [str(v.given), str(v.family)].filter(Boolean).join(" ") || undefined;
  }
  return str(v);
}

function normalizeAuthor(
  v: unknown,
  byKey: Map<string, Affiliation>
): Author | undefined {
  if (!isObj(v)) {
    const name = str(v);
    return name ? { name, affiliations: [] } : undefined;
  }

  const name = normalizeAuthorName(v.name);
  if (!name) return undefined;

  const affiliations = toArray(v.affiliations ?? v.affiliation)
    .map((a) => normalizeAffiliation(a, byKey))
    .filter((a): a is Affiliation => !!a);

  const author: Author = { name, affiliations };
  for (const key of ["email", "orcid", "url"] as const) {
    const value = str(v[key]);
    if (value) author[key] = value;
  }
  if (typeof v.corresponding === "boolean") author.corresponding = v.corresponding;
  return author;
}

function normalizeMeta(data: Obj): FrontmatterMeta {
  // Top-level affiliations are indexed by id and by name so authors can refer
  // to them by either.
  const byKey = new Map<string, Affiliation>();
  for (const raw of toArray(data.affiliations)) {
    const aff = normalizeAffiliation(raw, byKey);
    if (!aff) continue;
    if (aff.id) byKey.set(aff.id, aff);
    if (!byKey.has(aff.name)) byKey.set(aff.name, aff);
  }

  const authors = toArray(data.author ?? data.authors)
    .map((a) => normalizeAuthor(a, byKey))
    .filter((a): a is Author => !!a);

  return {
    title: str(data.title),
    subtitle: str(data.subtitle),
    abstract: str(data.abstract),
    date: normalizeDate(data.date),
    tags: normalizeTags(data.tags),
    bibliography: normalizeStringList(data.bibliography),
    authors,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

const EMPTY_META: FrontmatterMeta = { tags: [], bibliography: [], authors: [] };

export function parseFrontmatter(source: string): ParsedFrontmatter {
  const match = FRONTMATTER_RE.exec(source);
  if (!match) {
    return { content: source, data: {}, meta: { ...EMPTY_META } };
  }

  let value: unknown;
  try {
    value = parse(match[1]);
  } catch (err) {
    if (err instanceof YAMLParseError) {
      // +1: the opening fence occupies line 1 of the source.
      const line = err.linePos ? err.linePos[0].line + 1 : undefined;
      throw new FrontmatterError(err.message.split("\n")[0], line);
    }
    throw err;
  }

  if (value === null || value === undefined) value = {};
  if (!isObj(value)) {
    throw new FrontmatterError("the header must be a YAML mapping of keys to values");
  }

  return {
    content: source.slice(match[0].length),
    data: value,
    meta: normalizeMeta(value),
  };
}
