import type { BibEntry } from "./bibliography";

/**
 * BibTeX source -> JSON entries. Pure (no Node imports), but the browser
 * normally doesn't parse: it gets the JSON from the host's /api/bib/<key>.
 *
 * Handles many entries per file, `{...}` / `"..."` / bare values, `#`
 * concatenation, `@string` macros (plus the standard month names), `(...)`
 * as well as `{...}` entry delimiters, and skips `@comment` / `@preamble`.
 *
 * A malformed entry is reported in `errors` (with line and column) and
 * skipped; parsing resumes at the next `@type{`, so one typo does not take
 * down the rest of the file.
 *
 * Each entry keeps `rawSource`, its text as written (macros unexpanded, crossref not
 * applied), so the original can always be recovered or re-parsed.
 *
 * After parsing, each entry is normalised:
 *   - biblatex names are mapped to their BibTeX equivalents when the BibTeX
 *     field is absent (`journaltitle` -> `journal`, `location` -> `address`,
 *     `date = {2020-05-01}` -> `year` and `month`). The original field stays.
 *   - `crossref` is resolved: fields the entry lacks are inherited from the
 *     parent (a proceedings volume's `title` becomes the child's `booktitle`).
 *     A bad crossref is reported in `warnings` and the entry is kept.
 *
 * Lines starting with `%` are comments, even if they mention an `@type`.
 * Cite keys are case-sensitive, as in biblatex: `Foo` and `foo` are two keys.
 */

export class BibTeXParseError extends Error {
  /** 1-based position in the source. */
  readonly line: number;
  readonly column: number;
  /** Cite key of the broken entry, when its header parsed far enough to know it. */
  readonly citeKey?: string;

  constructor(message: string, line: number, column: number, citeKey?: string) {
    super(`${message} (line ${line}, column ${column})`);
    this.name = "BibTeXParseError";
    this.line = line;
    this.column = column;
    this.citeKey = citeKey;
  }
}

export interface ParsedBibTeX {
  entries: BibEntry[];
  /** Entries that were skipped. */
  errors: BibTeXParseError[];
  /** Entries that were kept despite a problem, such as a `crossref` to an unknown key. */
  warnings: BibTeXParseError[];
}

/** 1-based line and column of offset `at` in `src`. */
function positionOf(src: string, at: number): { line: number; column: number } {
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < at && i < src.length; i++) {
    if (src[i] === "\n") {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, column: at - lineStart + 1 };
}

const MONTHS: Record<string, string> = {
  jan: "January", feb: "February", mar: "March", apr: "April",
  may: "May", jun: "June", jul: "July", aug: "August",
  sep: "September", oct: "October", nov: "November", dec: "December",
};

const OPENERS: Record<string, string> = { "{": "}", "(": ")" };

class Scanner {
  pos = 0;
  constructor(readonly src: string) {}

  fail(message: string, at = this.pos, citeKey?: string): never {
    const { line, column } = positionOf(this.src, at);
    throw new BibTeXParseError(message, line, column, citeKey);
  }

  skipWhitespace(): void {
    while (this.pos < this.src.length && /\s/.test(this.src[this.pos])) this.pos++;
  }

  /** Reads a `{...}` group with balanced braces; returns the inside. */
  readBraced(citeKey?: string): string {
    const start = this.pos;
    let depth = 0;
    for (let i = start; i < this.src.length; i++) {
      const ch = this.src[i];
      if (ch === "{") depth++;
      else if (ch === "}" && --depth === 0) {
        this.pos = i + 1;
        return this.src.slice(start + 1, i);
      }
    }
    return this.fail("unclosed '{'", start, citeKey);
  }

  /** Reads a `"..."` string; quotes inside braces do not end it. */
  readQuoted(citeKey?: string): string {
    const start = this.pos;
    let depth = 0;
    for (let i = start + 1; i < this.src.length; i++) {
      const ch = this.src[i];
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      else if (ch === '"' && depth === 0) {
        this.pos = i + 1;
        return this.src.slice(start + 1, i);
      }
    }
    return this.fail("unclosed '\"'", start, citeKey);
  }

  /** Reads `name = value # value ...` pieces, expanding macros. */
  readValue(macros: Map<string, string>, citeKey?: string): string {
    let value = "";
    for (;;) {
      this.skipWhitespace();
      const ch = this.src[this.pos];
      if (ch === "{") value += this.readBraced(citeKey);
      else if (ch === '"') value += this.readQuoted(citeKey);
      else {
        const start = this.pos;
        const token = /^[^\s,{}()"#=]+/.exec(this.src.slice(start))?.[0];
        if (!token) return this.fail("expected a field value", start, citeKey);
        this.pos += token.length;
        if (/^\d+$/.test(token)) value += token;
        else {
          const macro = macros.get(token.toLowerCase()) ?? MONTHS[token.toLowerCase()];
          if (macro === undefined) return this.fail(`undefined string macro '${token}'`, start, citeKey);
          value += macro;
        }
      }
      this.skipWhitespace();
      if (this.src[this.pos] !== "#") return value;
      this.pos++;
    }
  }
}

/** Splits a name list on " and " outside braces, so {Barnes and Noble} stays whole. */
function splitNames(raw: string | undefined): string[] {
  if (!raw) return [];
  const names: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === "{") depth++;
    else if (ch === "}") depth = Math.max(0, depth - 1);
    else if (depth === 0 && /\s/.test(ch)) {
      const m = /^\s+and\s+/i.exec(raw.slice(i));
      if (m) {
        names.push(raw.slice(start, i));
        i += m[0].length - 1;
        start = i + 1;
      }
    }
  }
  names.push(raw.slice(start));
  return names.map((n) => n.replace(/\s+/g, " ").trim()).filter(Boolean);
}

// ─── Normalisation: biblatex aliases and crossref ─────────────────────────────

type Fields = Record<string, string>;

interface RawEntry {
  key: string;
  type: string;
  fields: Fields;
  /** Offset of the cite key, for warnings. */
  at: number;
  /** The entry's text as written. */
  raw: string;
}

const MONTH_NAMES = Object.values(MONTHS);

/** biblatex field -> the BibTeX field the formatters read. */
const FIELD_ALIASES: Record<string, string> = {
  journaltitle: "journal",
  location: "address",
};

/** `2020`, `2020-05`, `2020-05-01`, or a range `2020-05-01/2020-06-01` (the start is used). */
function parseBiblatexDate(value: string): { year: string; month?: string } | null {
  const m = /^\s*(\d{4})(?:-(\d{1,2}))?/.exec(value);
  if (!m) return null;
  const month = m[2] ? MONTH_NAMES[Number(m[2]) - 1] : undefined;
  return { year: m[1], month };
}

/** Adds the BibTeX spelling of biblatex fields. Never overrides a field that is there. */
function applyAliases(fields: Fields): void {
  for (const [alias, canonical] of Object.entries(FIELD_ALIASES)) {
    if (fields[alias] && !(canonical in fields)) fields[canonical] = fields[alias];
  }
  if (fields.date && !("year" in fields)) {
    const date = parseBiblatexDate(fields.date);
    if (date) {
      fields.year = date.year;
      if (date.month && !("month" in fields)) fields.month = date.month;
    }
  }
}

/** Child types that are a part of a larger work, whose parent's title is their `booktitle`. */
const PART_OF_BOOK = new Set(["inproceedings", "conference", "incollection", "inbook", "bookinbook", "suppbook", "inreference"]);
/** Of those, the ones written by the parent's author (a chapter of a monograph). */
const SAME_AUTHOR_AS_PARENT = new Set(["inbook", "bookinbook", "suppbook"]);

/** Never copied from a parent: they describe the parent itself, not the child. */
const NOT_INHERITED = new Set([
  "crossref", "xref", "xdata", "ids", "options", "key", "label", "shorthand", "sortkey", "sorttitle",
  "title", "subtitle", "titleaddon", "author", "chapter", "pages", "pagetotal", "note", "addendum",
  "abstract", "annotation", "keywords", "file", "doi", "url", "urldate", "eprint", "eprinttype", "eprintclass",
  // Handled together: a child with its own year keeps its own month and date.
  "year", "month", "date",
]);

/** Fills in `child` from `parent`, which must already be resolved itself. */
function inheritFrom(child: RawEntry, parentEntry: RawEntry): void {
  const c = child.fields;
  const p = parentEntry.fields;
  const inherit = (name: string, value: string | undefined) => {
    if (value && !(name in c)) c[name] = value;
  };

  if (PART_OF_BOOK.has(child.type)) {
    inherit("booktitle", p.title);
    inherit("booksubtitle", p.subtitle);
    inherit("booktitleaddon", p.titleaddon);
  }
  if (parentEntry.type === "periodical") inherit("journal", p.title);
  if (SAME_AUTHOR_AS_PARENT.has(child.type)) inherit("author", p.author);

  for (const [name, value] of Object.entries(p)) {
    if (!NOT_INHERITED.has(name)) inherit(name, value);
  }
  if (!("year" in c)) {
    inherit("year", p.year);
    inherit("month", p.month);
    inherit("date", p.date);
  }
}

/** Applies aliases, then resolves every `crossref`, parents before children. */
function normalise(raws: RawEntry[], source: string, warnings: BibTeXParseError[]): void {
  for (const raw of raws) applyAliases(raw.fields);

  const byKey = new Map(raws.map((raw) => [raw.key, raw]));
  const state = new Map<RawEntry, "resolving" | "done">();
  const warn = (raw: RawEntry, message: string) => {
    const { line, column } = positionOf(source, raw.at);
    warnings.push(new BibTeXParseError(message, line, column, raw.key));
  };

  const resolve = (raw: RawEntry): void => {
    if (state.has(raw)) return;
    state.set(raw, "resolving");
    const ref = raw.fields.crossref?.trim();
    if (ref) {
      const parent = byKey.get(ref);
      if (!parent) warn(raw, `'${raw.key}' has crossref '${ref}', which is not an entry in this file`);
      else if (state.get(parent) === "resolving") warn(raw, `crossref cycle: '${raw.key}' -> '${parent.key}'`);
      else {
        resolve(parent);
        inheritFrom(raw, parent);
      }
    }
    state.set(raw, "done");
  };
  raws.forEach(resolve);
}

/**
 * Offset of the next `@` that can start an entry, or -1. An `@` on a line whose
 * first character is `%` belongs to a comment, as it does for biber: `% @article{...}`
 * is a commented-out entry, and `% see @cite(x)` is prose.
 */
function nextAt(source: string, from: number): number {
  for (let at = source.indexOf("@", from); at !== -1; at = source.indexOf("@", at + 1)) {
    const lineStart = source.lastIndexOf("\n", at - 1) + 1;
    if (!/^\s*%/.test(source.slice(lineStart, at))) return at;
  }
  return -1;
}

const NEXT_ENTRY_RE = /\n[ \t]*@[A-Za-z]+[ \t]*[{(]/g;

export function parseBibTeX(source: string): ParsedBibTeX {
  // Explicitly typed so calls to the `never`-returning s.fail() narrow types.
  const s: Scanner = new Scanner(source);
  const raws: RawEntry[] = [];
  const errors: BibTeXParseError[] = [];
  const warnings: BibTeXParseError[] = [];
  const macros = new Map<string, string>();
  const seenKeys = new Set<string>();

  // Everything outside an `@type{...}` block is a comment, as in BibTeX.
  while ((s.pos = nextAt(source, s.pos)) !== -1) {
    const entryStart = s.pos;
    try {
      s.pos++;
      const type = /^[A-Za-z]+/.exec(source.slice(s.pos))?.[0];
      if (!type) s.fail("expected an entry type after '@'");
      s.pos += type.length;
      s.skipWhitespace();
      const open = source[s.pos];
      const close = OPENERS[open];
      if (!close) s.fail(`expected '{' or '(' after @${type}`);
      const entryType = type.toLowerCase();

      if (entryType === "comment" || entryType === "preamble") {
        if (open === "{") s.readBraced();
        else s.pos = Math.max(source.indexOf(")", s.pos) + 1, s.pos + 1);
        continue;
      }

      s.pos++;

      if (entryType === "string") {
        s.skipWhitespace();
        const name = /^[^\s=,{}()"#]+/.exec(source.slice(s.pos))?.[0];
        if (!name) s.fail("expected a macro name in @string");
        s.pos += name.length;
        s.skipWhitespace();
        if (source[s.pos] !== "=") s.fail(`expected '=' after macro name '${name}'`);
        s.pos++;
        macros.set(name.toLowerCase(), s.readValue(macros));
        s.skipWhitespace();
        if (source[s.pos] !== close) s.fail(`expected '${close}' to end @string`);
        s.pos++;
        continue;
      }

      s.skipWhitespace();
      const keyStart = s.pos;
      const key = /^[^\s,{}()"#=]*/.exec(source.slice(keyStart))![0];
      if (!key) s.fail(`@${entryType} has no cite key`, keyStart);
      s.pos += key.length;
      if (seenKeys.has(key)) s.fail(`duplicate cite key '${key}'`, keyStart, key);

      const fields: Record<string, string> = {};
      for (;;) {
        s.skipWhitespace();
        const ch = source[s.pos];
        if (ch === undefined) s.fail(`entry '${key}' is not closed`, entryStart, key);
        if (ch === ",") {
          s.pos++;
          continue;
        }
        if (ch === close) {
          s.pos++;
          break;
        }
        const nameStart = s.pos;
        const name = /^[^\s=,{}()"#]+/.exec(source.slice(nameStart))?.[0];
        if (!name) s.fail(`expected a field name in '${key}'`, nameStart, key);
        s.pos += name.length;
        s.skipWhitespace();
        if (source[s.pos] !== "=") s.fail(`expected '=' after field '${name}' in '${key}'`, s.pos, key);
        s.pos++;
        const value = s.readValue(macros, key).replace(/\s+/g, " ").trim();
        const field = name.toLowerCase();
        // As in BibTeX, the first occurrence of a repeated field wins.
        if (!(field in fields)) fields[field] = value;
      }

      seenKeys.add(key);
      raws.push({ key, type: entryType, fields, at: keyStart, raw: source.slice(entryStart, s.pos) });
    } catch (err) {
      if (!(err instanceof BibTeXParseError)) throw err;
      errors.push(err);
      // Resume at the next entry header after the one that failed.
      NEXT_ENTRY_RE.lastIndex = entryStart + 1;
      const next = NEXT_ENTRY_RE.exec(source);
      s.pos = next ? next.index + 1 : source.length;
    }
  }

  normalise(raws, source, warnings);
  // Names are split last, so they include any editors inherited through crossref.
  const entries: BibEntry[] = raws.map(({ key, type, fields, raw }) => ({
    citeKey: key,
    entryType: type,
    fields,
    authors: splitNames(fields.author),
    editors: splitNames(fields.editor),
    rawSource: raw,
  }));
  return { entries, errors, warnings };
}
