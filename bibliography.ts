/**
 * bibliography.ts
 *
 * Everything the renderer needs to turn `@cite(key)` into a citation and a
 * reference list, without knowing where entries come from:
 *
 *   - BibEntry: the JSON shape of one BibTeX entry
 *   - BibResolver: `key -> BibEntry | null`, supplied by the host. On the
 *     server it can read a file directly; in the browser, createFetchResolver
 *     asks an HTTP endpoint (`GET <endpoint>/<key>`).
 *   - resolveBibliography: runs a resolver over every cited key
 *   - formatReference: author-year (APA-like) text for one entry
 *
 * Client-safe: no Node imports. BibTeX parsing is the host's job; this file
 * only consumes its JSON.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BibEntry {
  /** UUID v4, made by the client when it creates an entry (see newEntryId). Entries parsed from a .bib file have none. */
  id?: string;
  citeKey: string;
  /** Lowercased: article, book, inproceedings, ... */
  entryType: string;
  /** Every field, lowercased names, raw (LaTeX-escaped) values. */
  fields: Record<string, string>;
  /** Raw name strings, one per person, as written in the .bib file. */
  authors: string[];
  editors: string[];
  /** The entry's original BibTeX text, as pasted or read from the file. */
  rawSource?: string;
  /** RFC 3339. Set by the server, never by the client. */
  createdAt?: string;
  lastModified?: string;
}

/** Why a value is not a BibEntry; `path` says where, e.g. `fields.year`. */
export class BibEntryValidationError extends Error {
  constructor(readonly path: string, message: string) {
    super(`Invalid bibliography entry: ${path} ${message}`);
    this.name = "BibEntryValidationError";
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function stringList(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) throw new BibEntryValidationError(path, "must be an array of strings");
  value.forEach((v, i) => {
    if (typeof v !== "string") throw new BibEntryValidationError(`${path}[${i}]`, "must be a string");
  });
  return value as string[];
}

/**
 * Checks that untrusted JSON (an API response) has the shape of a BibEntry and
 * returns it typed; throws BibEntryValidationError naming the first problem.
 * Strict about shape, lenient about case: `entryType` and field names are
 * lowercased, as the parser would have written them. Unknown fields and
 * entry types are fine, since BibTeX has no closed list of either.
 */
export function validateBibEntry(value: unknown): BibEntry {
  if (!isRecord(value)) throw new BibEntryValidationError("entry", "must be an object");
  const { citeKey, entryType, fields, authors, editors } = value;
  if (typeof citeKey !== "string" || !citeKey.trim()) {
    throw new BibEntryValidationError("citeKey", "must be a non-empty string");
  }
  if (typeof entryType !== "string" || !/^[A-Za-z]+$/.test(entryType)) {
    throw new BibEntryValidationError("entryType", "must be a word of letters, like \"article\"");
  }
  if (!isRecord(fields)) throw new BibEntryValidationError("fields", "must be an object");
  const cleanFields: Record<string, string> = {};
  for (const [name, v] of Object.entries(fields)) {
    if (typeof v !== "string") throw new BibEntryValidationError(`fields.${name}`, "must be a string");
    cleanFields[name.toLowerCase()] = v;
  }
  const entry: BibEntry = {
    citeKey,
    entryType: entryType.toLowerCase(),
    fields: cleanFields,
    authors: stringList(authors, "authors"),
    editors: stringList(editors, "editors"),
  };
  const { id, rawSource, createdAt, lastModified } = value;
  if (id !== undefined) {
    if (typeof id !== "string" || !UUID_RE.test(id)) throw new BibEntryValidationError("id", "must be a UUID");
    entry.id = id.toLowerCase();
  }
  for (const [name, v] of [["rawSource", rawSource], ["createdAt", createdAt], ["lastModified", lastModified]] as const) {
    if (v === undefined || v === null) continue;
    if (typeof v !== "string") throw new BibEntryValidationError(name, "must be a string");
    entry[name] = v;
  }
  return entry;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A new random (version 4) UUID, for the id of an entry the client creates. */
export function newEntryId(): string {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === "function") return c.randomUUID();
  // randomUUID needs a secure context (https or localhost); getRandomValues does not.
  const b = c.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; // version 4
  b[8] = (b[8] & 0x3f) | 0x80; // variant 10
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// The server enforces the same limits (db_design_impl.rs), so the client can say so first.
const MAX_KEY_LENGTH = 255;
const MAX_FIELDS = 200;
const MAX_VALUE_BYTES = 50_000;
const MAX_NAMES = 1_000;
const MAX_NAME_BYTES = 1_000;
const byteLength = (text: string) => new TextEncoder().encode(text).length;

/**
 * Why the server would refuse this entry, in words for the person who pasted it;
 * empty when it would accept it. validateBibEntry checks the shape; this checks
 * what the shape cannot: key characters, an entry with nothing to identify it, sizes.
 */
export function bibEntryProblems(entry: BibEntry): string[] {
  const problems: string[] = [];
  const key = entry.citeKey;
  if (!key || [...key].length > MAX_KEY_LENGTH || /[\s,{}()"#=]/.test(key) || /\p{Cc}/u.test(key)) {
    problems.push('the cite key must be 1 to 255 characters, with no spaces and none of , { } ( ) " # =');
  }
  if (!/^[A-Za-z]+$/.test(entry.entryType)) problems.push('the entry type must be letters, like "article"');

  const names = [...entry.authors, ...entry.editors].map((n) => n.trim()).filter(Boolean);
  const hasTitle = (entry.fields.title ?? "").trim() !== "";
  if (!hasTitle && names.length === 0) problems.push("it needs a title or at least one author or editor");

  const fields = Object.entries(entry.fields);
  if (fields.length > MAX_FIELDS) problems.push(`it has too many fields (at most ${MAX_FIELDS})`);
  for (const [name, value] of fields) {
    if (name.length > 100) problems.push(`the field name "${name.slice(0, 20)}…" is too long`);
    if (byteLength(value) > MAX_VALUE_BYTES) problems.push(`the field "${name}" is too long`);
  }
  if (entry.authors.length > MAX_NAMES || entry.editors.length > MAX_NAMES) {
    problems.push(`it has too many names (at most ${MAX_NAMES} per list)`);
  }
  if (names.some((n) => byteLength(n) > MAX_NAME_BYTES)) problems.push("a name is too long");
  return problems;
}

export function isBibEntry(value: unknown): value is BibEntry {
  try {
    validateBibEntry(value);
    return true;
  } catch {
    return false;
  }
}

/** Resolves a cite key; null/undefined means "no such entry". May throw. */
export type BibResolver = (key: string) => Promise<BibEntry | null | undefined>;

/**
 * Resolved entries by cite key, as written in the document. A null value is a
 * key that could not be resolved. Cite keys are case-sensitive.
 */
export type BibliographyMap = Map<string, BibEntry | null>;

// ─── Citation syntax ──────────────────────────────────────────────────────────

/** `@cite(key)` or `@cite(key1, key2)`. Group 1 is the comma-separated keys. */
export const CITE_RE_SOURCE = String.raw`@cite\(([^)]*)\)`;

/** BibTeX keys cannot contain commas, so commas (and semicolons) separate keys. */
export function splitCiteKeys(group: string): string[] {
  return group
    .split(/[,;]/)
    .map((k) => k.trim())
    .filter(Boolean);
}

// ─── Resolving ────────────────────────────────────────────────────────────────

/**
 * Resolves every key in parallel. One bad key never aborts the others: a
 * missing entry or a failing resolver yields `null` (and a console warning) so
 * the page can still render with a visible marker for that citation.
 */
export async function resolveBibliography(
  keys: string[],
  resolver: BibResolver
): Promise<BibliographyMap> {
  const unique = [...new Set(keys)];
  const entries = await Promise.all(
    unique.map(async (key) => {
      try {
        const entry = await resolver(key);
        if (!entry) console.warn(`Bibliography: no entry found for "${key}"`);
        return entry ?? null;
      } catch (err) {
        console.warn(`Bibliography: could not resolve "${key}"`, err);
        return null;
      }
    })
  );
  return new Map(unique.map((key, i) => [key, entries[i]]));
}

/**
 * Fetches `<endpoint>/<key>`. 404 → null; any other failure throws, including
 * a body that is not a valid entry or is for a different key.
 */
export async function fetchBibEntry(
  key: string,
  endpoint = "/api/bib",
  fetchImpl: typeof fetch = fetch
): Promise<BibEntry | null> {
  const res = await fetchImpl(`${endpoint.replace(/\/+$/, "")}/${encodeURIComponent(key)}`);
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Failed to fetch bibliography entry "${key}": ${res.status} ${res.statusText}`);
  }
  const entry = validateBibEntry(await res.json());
  if (entry.citeKey !== key) {
    throw new BibEntryValidationError("citeKey", `is "${entry.citeKey}", but "${key}" was requested`);
  }
  return entry;
}

/**
 * A BibResolver backed by fetchBibEntry. Results are cached per resolver, so
 * several renderers on one page citing the same key make one request. Failed
 * requests are not cached.
 */
export function createFetchResolver(
  endpoint = "/api/bib",
  fetchImpl?: typeof fetch
): BibResolver {
  const cache = new Map<string, Promise<BibEntry | null>>();
  return (key) => {
    let hit = cache.get(key);
    if (!hit) {
      hit = fetchBibEntry(key, endpoint, fetchImpl);
      cache.set(key, hit);
      hit.catch(() => cache.delete(key));
    }
    return hit;
  };
}

// ─── LaTeX → text ─────────────────────────────────────────────────────────────

// Combining marks for the accent commands: \'e \"o \^a \~n \`e \=a \.z
const ACCENTS: Record<string, string> = {
  "`": "̀",
  "'": "́",
  "^": "̂",
  "~": "̃",
  "=": "̄",
  '"': "̈",
  ".": "̇",
  c: "̧",
  v: "̌",
  u: "̆",
  H: "̋",
  k: "̨",
};

const LETTERS: Record<string, string> = {
  ss: "ß", ae: "æ", AE: "Æ", oe: "œ", OE: "Œ", aa: "å", AA: "Å",
  o: "ø", O: "Ø", l: "ł", L: "Ł", i: "i", j: "j",
};

/** The text-mode part of cleanLatex: everything except `$...$` math. */
function stripLatex(input: string): string {
  return input
    .replace(/\\([`'^~=."])\s*\{\\?([A-Za-z])\}|\\([`'^~=."])\s*\\?([A-Za-z])/g, (_m, a1, l1, a2, l2) =>
      ((l1 ?? l2) + ACCENTS[a1 ?? a2]).normalize("NFC")
    )
    // \c{c} \v{s} \u{g} \H{o} \k{a}: letter commands need a brace or space so
    // `\url{...}` is not read as the breve accent.
    .replace(/\\([cvuHk])(?:\{([A-Za-z])\}|\s+([A-Za-z]))/g, (_m, a, l1, l2) =>
      ((l1 ?? l2) + ACCENTS[a]).normalize("NFC")
    )
    .replace(/\\(ss|ae|AE|oe|OE|aa|AA|o|O|l|L|i|j)(?![A-Za-z])(?:\{\}|\s)?/g, (_m, c) => LETTERS[c])
    .replace(/\\([&%$#_{}])/g, "$1")
    .replace(/\\[A-Za-z]+\s*\{([^{}]*)\}/g, "$1") // \emph{x}, \url{x}, \textit{x}
    .replace(/\\[A-Za-z]+\s*/g, "")
    .replace(/---/g, "—")
    .replace(/--/g, "–")
    .replace(/~/g, " ")
    .replace(/[{}]/g, "");
}

/** `$...$` is math, kept as written for KaTeX. A `\$` is a dollar sign, not a delimiter. */
const MATH_SPLIT = /((?<!\\)\$(?:\\.|[^$\\])+\$)/;

/**
 * Splits text into plain runs and `$...$` math runs (delimiters included on the
 * math ones). Math is every second piece of `split` with a capturing group.
 */
export function splitMath(input: string): { math: boolean; value: string }[] {
  return input
    .split(MATH_SPLIT)
    .map((value, i) => ({ math: i % 2 === 1, value }))
    .filter((part) => part.value !== "");
}

/**
 * Best-effort BibTeX/LaTeX → plain text for display: accents, escaped
 * symbols, dashes and protective braces. Not a LaTeX interpreter; unknown
 * commands lose their backslash and braces but keep their argument. `$...$`
 * math is left exactly as written, for the renderer to typeset (see splitMath).
 */
export function cleanLatex(input: string): string {
  return input
    .split(MATH_SPLIT)
    .map((part, i) => (i % 2 === 1 ? part : stripLatex(part)))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanUrl(input: string): string {
  return input.replace(/\\([&%$#_])/g, "$1").replace(/[{}]/g, "").trim();
}

// ─── Names ────────────────────────────────────────────────────────────────────

interface Person {
  family: string;
  given: string;
  /** "Jr.", "III": only a "Last, Jr, First" name has one. */
  suffix: string;
  /** A single braced name such as {World Health Organization}. */
  literal: boolean;
}

/** Splits on `sep` outside braces. */
function splitTopLevel(s: string, sep: RegExp): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "{") depth++;
    else if (ch === "}") depth = Math.max(0, depth - 1);
    else if (depth === 0 && sep.test(ch)) {
      parts.push(s.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(s.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
}

function isSingleGroup(s: string): boolean {
  if (!s.startsWith("{") || !s.endsWith("}")) return false;
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "{") depth++;
    else if (s[i] === "}" && --depth === 0 && i < s.length - 1) return false;
  }
  return true;
}

function parsePerson(raw: string): Person {
  const name = raw.trim();
  if (isSingleGroup(name)) return { family: cleanLatex(name), given: "", suffix: "", literal: true };

  const commaParts = splitTopLevel(name, /,/);
  if (commaParts.length > 1) {
    // "Last, First" or "Last, Jr, First"
    return {
      family: cleanLatex(commaParts[0]),
      given: cleanLatex(commaParts[commaParts.length - 1]),
      suffix: commaParts.length > 2 ? cleanLatex(commaParts.slice(1, -1).join(", ")) : "",
      literal: false,
    };
  }

  // "First von Last", as BibTeX reads it: the family name starts at the first
  // lowercase word after the first one ("de Roda Gil"), else it is the last word.
  const words = splitTopLevel(name, /\s/);
  if (words.length <= 1) return { family: cleanLatex(name), given: "", suffix: "", literal: false };
  let familyStart = words.length - 1;
  for (let i = 1; i < words.length - 1; i++) {
    if (/^\p{Ll}/u.test(words[i])) {
      familyStart = i;
      break;
    }
  }
  return {
    family: cleanLatex(words.slice(familyStart).join(" ")),
    given: cleanLatex(words.slice(0, familyStart).join(" ")),
    suffix: "",
    literal: false,
  };
}

function initials(given: string): string {
  return given
    .split(/\s+/)
    .filter(Boolean)
    .map((word) =>
      word
        .split("-")
        .filter(Boolean)
        .map((part) => `${part[0].toUpperCase()}.`)
        .join("-")
    )
    .join(" ");
}

// ─── Styles ───────────────────────────────────────────────────────────────────

/** How each entry in the reference list is written. */
export enum ReferenceStyle {
  APA = "apa",
  MLA = "mla",
  Vancouver = "vancouver",
}

/** How `@cite(key)` appears in the text. */
export enum CitationStyle {
  /** (Smith & Doe, 2020) */
  AuthorYear = "author-year",
  /** (Smith & Doe) */
  Author = "author",
  /** [1] — the entry's position in the reference list */
  Number = "number",
}

/** Order of the reference list (and so of the numbers, for CitationStyle.Number). */
export enum ReferenceSort {
  /** Order of first citation in the document. */
  Appearance = "appearance",
  /** Author surname, then year, then title. */
  Author = "author",
  /** Oldest first; entries without a year last. */
  Date = "date",
}

/** An enum member or its string value, so both `ReferenceStyle.MLA` and `"mla"` work. */
type EnumValue<E extends string> = E | `${E}`;

export interface CitationConfig {
  /** Default: APA. */
  referenceStyle?: EnumValue<ReferenceStyle>;
  /** Default depends on referenceStyle: APA author-year, MLA author, Vancouver number. */
  citationStyle?: EnumValue<CitationStyle>;
  /** Default depends on referenceStyle: APA and MLA author, Vancouver appearance. */
  sort?: EnumValue<ReferenceSort>;
}

export interface ResolvedCitationConfig {
  referenceStyle: ReferenceStyle;
  citationStyle: CitationStyle;
  sort: ReferenceSort;
}

const STYLE_DEFAULTS: Record<ReferenceStyle, Omit<ResolvedCitationConfig, "referenceStyle">> = {
  [ReferenceStyle.APA]: { citationStyle: CitationStyle.AuthorYear, sort: ReferenceSort.Author },
  [ReferenceStyle.MLA]: { citationStyle: CitationStyle.Author, sort: ReferenceSort.Author },
  [ReferenceStyle.Vancouver]: { citationStyle: CitationStyle.Number, sort: ReferenceSort.Appearance },
};

function oneOf<E extends string>(kind: string, values: Record<string, E>, value: string): E {
  if (!Object.values(values).includes(value as E)) {
    throw new Error(
      `Unknown ${kind} "${value}"; expected one of ${Object.values(values).join(", ")}`
    );
  }
  return value as E;
}

/** Fills in defaults and checks the values (they may come from plain JS or JSON). */
export function resolveCitationConfig(config: CitationConfig = {}): ResolvedCitationConfig {
  const referenceStyle = oneOf("reference style", ReferenceStyle, config.referenceStyle ?? ReferenceStyle.APA);
  const defaults = STYLE_DEFAULTS[referenceStyle];
  return {
    referenceStyle,
    citationStyle: oneOf("citation style", CitationStyle, config.citationStyle ?? defaults.citationStyle),
    sort: oneOf("reference sort", ReferenceSort, config.sort ?? defaults.sort),
  };
}

/** Heading of the list appended to the document. */
export function referencesHeading(style: ReferenceStyle): string {
  return style === ReferenceStyle.MLA ? "Works Cited" : "References";
}

// ─── Names, per style ─────────────────────────────────────────────────────────

// "and others" is BibTeX for "et al."
function splitOthers(names: string[]): { people: Person[]; etAl: boolean } {
  const etAl = names.length > 0 && names[names.length - 1].trim().toLowerCase() === "others";
  return { people: (etAl ? names.slice(0, -1) : names).map(parsePerson), etAl };
}

const isPlain = (p: Person) => p.literal || !p.given;

/** APA: "Smith, J., Doe, A., & Roe, B." */
function apaNameList(names: string[]): string {
  const { people, etAl } = splitOthers(names);
  const formatted = people.map((p) => (isPlain(p) ? p.family : `${p.family}, ${initials(p.given)}${p.suffix ? `, ${p.suffix}` : ""}`));
  if (etAl) return formatted.length > 0 ? `${formatted.join(", ")}, et al.` : "et al.";
  if (formatted.length <= 1) return formatted[0] ?? "";
  return `${formatted.slice(0, -1).join(", ")}, & ${formatted[formatted.length - 1]}`;
}

const natural = (p: Person) => (isPlain(p) ? p.family : `${p.given} ${p.family}${p.suffix ? ` ${p.suffix}` : ""}`);

/** MLA: "Smith, John, and Anna Doe." / "Smith, John, et al." */
function mlaNameList(names: string[]): string {
  const { people, etAl } = splitOthers(names);
  if (people.length === 0) return "";
  const first = isPlain(people[0])
    ? people[0].family
    : `${people[0].family}, ${people[0].given}${people[0].suffix ? `, ${people[0].suffix}` : ""}`;
  if (etAl || people.length >= 3) return `${first}, et al.`;
  if (people.length === 2) return `${first}, and ${natural(people[1])}`;
  return first;
}

/** MLA, for "edited by": "John Smith and Anna Doe". */
function mlaEditorList(names: string[]): string {
  const { people, etAl } = splitOthers(names);
  if (people.length === 0) return "";
  if (etAl || people.length >= 3) return `${natural(people[0])} et al.`;
  return people.map(natural).join(" and ");
}

function compactInitials(given: string): string {
  return given
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase())
    .join("");
}

/** Vancouver: "Smith J, Doe A", at most six, then "et al." */
function vancouverNameList(names: string[]): string {
  const { people, etAl } = splitOthers(names);
  const shown = people
    .slice(0, 6)
    .map((p) => (isPlain(p) ? p.family : `${p.family} ${compactInitials(p.given)}${p.suffix ? ` ${p.suffix}` : ""}`))
    .join(", ");
  if (shown === "") return etAl ? "et al." : "";
  return etAl || people.length > 6 ? `${shown}, et al.` : shown;
}

/** Family names for in-text citations: "Smith", "Smith & Doe", "Smith et al." */
function inlineNames(names: string[], style: ReferenceStyle): string {
  const { people, etAl } = splitOthers(names);
  if (people.length === 0) return "";
  if (etAl || people.length >= 3) return `${people[0].family} et al.`;
  if (people.length === 2) {
    return `${people[0].family} ${style === ReferenceStyle.MLA ? "and" : "&"} ${people[1].family}`;
  }
  return people[0].family;
}

// ─── Reference formatting ─────────────────────────────────────────────────────

/** A run of reference text; titles of containers are italic, DOIs/URLs link. */
export interface RefSegment {
  text: string;
  italic?: boolean;
  href?: string;
}

export interface FormattedReference {
  citeKey: string;
  /** In-text, CitationStyle.AuthorYear: "Smith et al., 2020". */
  authorYear: string;
  /** In-text, CitationStyle.Author: "Smith et al.". */
  author: string;
  segments: RefSegment[];
  /** What sortReferences orders by. */
  sortKey: { author: string; year: number; title: string };
}

type Fields = Record<string, string>;

function cleanFields(entry: BibEntry): Fields {
  const f: Fields = {};
  for (const [name, value] of Object.entries(entry.fields)) {
    f[name] = name === "url" || name === "doi" ? cleanUrl(value) : cleanLatex(value);
  }
  return f;
}

function ordinalEdition(edition: string): string {
  return /\bed\b|edition/i.test(edition) ? edition : `${edition} ed.`;
}

const endSentence = (s: string) => (/[.?!]$/.test(s) ? s : `${s}.`);
const doiUrl = (doi: string) => `https://doi.org/${doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")}`;

/** Accumulates RefSegments. Runs are separated by a space unless `space` is false. */
function createRuns() {
  const segments: RefSegment[] = [];
  const add = (text: string, extra: Partial<RefSegment> = {}, space = true) => {
    if (!text) return;
    if (space && segments.length > 0) segments[segments.length - 1].text += " ";
    segments.push({ text, ...extra });
  };
  return { segments, add };
}

// ─── Dates ────────────────────────────────────────────────────────────────────

const MONTH_FULL = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const MONTH_MLA = ["Jan.", "Feb.", "Mar.", "Apr.", "May", "June", "July", "Aug.", "Sept.", "Oct.", "Nov.", "Dec."];

interface PubDate {
  year: string;
  /** 0-based. */
  month?: number;
  day?: number;
}

/** 0-based month from "5", "05", "May", "may" or "Sept."; null if it is none of those. */
function monthIndex(value: string | undefined): number | null {
  const v = value?.trim().toLowerCase().replace(/\.$/, "");
  if (!v) return null;
  if (/^\d{1,2}$/.test(v)) return Number(v) >= 1 && Number(v) <= 12 ? Number(v) - 1 : null;
  if (v.length < 3) return null;
  const i = MONTH_FULL.findIndex((m) => m.toLowerCase().startsWith(v === "sept" ? "sep" : v));
  return i === -1 ? null : i;
}

/** `2020`, `2020-05`, `2020-05-01` (a range uses its start). */
function parseIsoDate(value: string | undefined): PubDate | null {
  const m = value ? /^\s*(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?/.exec(value) : null;
  if (!m) return null;
  const month = monthIndex(m[2]);
  return { year: m[1], month: month ?? undefined, day: month !== null && m[3] ? Number(m[3]) : undefined };
}

/** Year, month and day of publication. A month or day without a year is ignored. */
function pubDate(f: Fields): PubDate | null {
  if (!f.year) return null;
  const date = parseIsoDate(f.date);
  const sameYear = date?.year === f.year;
  const month = monthIndex(f.month) ?? (sameYear ? date?.month : undefined) ?? undefined;
  const day = sameYear && date?.month === month ? date?.day : undefined;
  return { year: f.year, month, day };
}

/** APA: "2020, May 1". */
const apaDate = (d: PubDate) =>
  d.month === undefined ? d.year : `${d.year}, ${MONTH_FULL[d.month]}${d.day ? ` ${d.day}` : ""}`;
/** APA, long form: "May 1, 2020". */
const apaLongDate = (d: PubDate) =>
  `${d.month === undefined ? "" : `${MONTH_FULL[d.month]} `}${d.day ? `${d.day}, ` : ""}${d.year}`;
/** MLA: "1 May 2020", "Sept. 2020". */
const mlaDate = (d: PubDate) =>
  `${d.day ? `${d.day} ` : ""}${d.month === undefined ? "" : `${MONTH_MLA[d.month]} `}${d.year}`;
/** Vancouver: "2020 May 1". */
const vancouverDate = (d: PubDate) =>
  `${d.year}${d.month === undefined ? "" : ` ${MONTH_FULL[d.month].slice(0, 3)}`}${d.day ? ` ${d.day}` : ""}`;

/** `urldate` as `format` writes it; text that is not a date is used as written. */
function accessed(f: Fields, format: (d: PubDate) => string): string | undefined {
  if (!f.urldate) return undefined;
  const d = parseIsoDate(f.urldate);
  return d ? format(d) : f.urldate;
}

/** `arXiv:1234.5678`, linked for arXiv. Shown only when there is no DOI, which says the same. */
function eprintSegment(f: Fields): { text: string; href?: string } | null {
  if (!f.eprint || f.doi) return null;
  const kind = f.eprinttype || "arXiv";
  return { text: `${kind}:${f.eprint}`, href: /^arxiv$/i.test(kind) ? `https://arxiv.org/abs/${f.eprint}` : undefined };
}

/** "US Patent No. 1,234" */
const patentNumber = (f: Fields) => (f.number ? `${f.address ? `${f.address} ` : ""}Patent No. ${f.number}` : undefined);

/** biblatex `type` values that name the entry type rather than a label to print. */
const TYPE_KEYWORDS = /^(mathesis|phdthesis|candthesis|techreport|resreport|thesis)$/i;
const typeLabel = (f: Fields) => (f.type && !TYPE_KEYWORDS.test(f.type) ? f.type : undefined);

/** Maps biblatex and web types onto the BibTeX types the formatters handle. */
function canonicalType(entry: BibEntry, f: Fields): string {
  switch (entry.entryType) {
    case "report":
      return "techreport";
    case "thesis":
      return /master|^ma/i.test(f.type ?? "") ? "mastersthesis" : "phdthesis";
    case "electronic":
    case "www":
      return "online";
    // biblatex @inbook has its own title and a `booktitle`; BibTeX's has only the book's title.
    case "inbook":
      return f.booktitle ? "incollection" : "inbook";
    default:
      return entry.entryType;
  }
}

function formatApa(entry: BibEntry, f: Fields): RefSegment[] {
  const { segments, add } = createRuns();
  // Journals and books are dated by year alone; web pages and the like by full date.
  const when = pubDate(f);
  const year = when ? (["online", "misc", "unpublished"].includes(entry.entryType) ? apaDate(when) : when.year) : "n.d.";
  const title = f.title ?? "";
  const leadNames = entry.authors.length > 0 ? entry.authors : entry.editors;
  const leadIsEditors = entry.authors.length === 0 && entry.editors.length > 0;
  const editorLabel = (names: string[]) => (splitOthers(names).people.length > 1 ? "Eds." : "Ed.");

  // With no authors or editors the title leads and the year follows it.
  if (leadNames.length > 0) {
    const label = leadIsEditors ? ` (${editorLabel(leadNames)})` : "";
    add(`${apaNameList(leadNames)}${label} (${year}).`);
  }

  const titleEnd = /[.?!]$/.test(title) ? "" : ".";
  const addTitle = (italic: boolean, tail = titleEnd) => {
    if (title) {
      if (italic) {
        add(title, { italic: true });
        add(tail, {}, false);
      } else {
        add(`${title}${tail}`);
      }
    }
    if (leadNames.length === 0) add(`(${year}).`);
  };

  switch (entry.entryType) {
    case "article": {
      addTitle(false);
      if (f.journal) {
        add(`${f.journal}${f.volume ? `, ${f.volume}` : ""}`, { italic: true });
        add(`${f.number ? `(${f.number})` : ""}${f.pages ? `, ${f.pages}` : ""}.`, {}, false);
      }
      break;
    }
    case "inproceedings":
    case "conference":
    case "incollection": {
      addTitle(false);
      if (f.booktitle) {
        const editors =
          entry.authors.length > 0 && entry.editors.length > 0
            ? `${apaNameList(entry.editors)} (${editorLabel(entry.editors)}), `
            : "";
        add(`In ${editors}`);
        add(f.booktitle, { italic: true }, false);
        const details = [f.edition && ordinalEdition(f.edition), f.volume && `Vol. ${f.volume}`, f.pages && `pp. ${f.pages}`].filter(Boolean);
        add(`${details.length > 0 ? ` (${details.join(", ")})` : ""}.`, {}, false);
      }
      const publisher = f.publisher || f.organization;
      if (publisher) add(`${publisher}.`);
      break;
    }
    case "phdthesis":
    case "mastersthesis": {
      const kind = entry.entryType === "phdthesis" ? "Doctoral dissertation" : "Master's thesis";
      addTitle(true, ` [${typeLabel(f) || kind}].`);
      if (f.school) add(`${f.school}.`);
      break;
    }
    case "techreport": {
      addTitle(true, ` (${typeLabel(f) || "Technical Report"}${f.number ? ` No. ${f.number}` : ""}).`);
      if (f.institution) add(`${f.institution}.`);
      break;
    }
    case "online": {
      addTitle(true);
      const site = f.publisher || f.organization || f.institution;
      if (site) add(endSentence(site));
      break;
    }
    case "software":
    case "dataset": {
      const kind = typeLabel(f) || (entry.entryType === "software" ? "Computer software" : "Data set");
      addTitle(true, `${f.version ? ` (Version ${f.version})` : ""} [${kind}].`);
      const publisher = f.publisher || f.organization || f.institution;
      if (publisher) add(endSentence(publisher));
      break;
    }
    case "patent": {
      const number = patentNumber(f);
      addTitle(true, number ? ` (${number}).` : titleEnd);
      const owner = f.holder || f.institution || f.organization || f.publisher;
      if (owner) add(endSentence(owner));
      break;
    }
    default: {
      // book, inbook, proceedings, manual, misc, unpublished, and anything custom.
      const inbook = entry.entryType === "inbook";
      const details = [
        f.edition && ordinalEdition(f.edition),
        f.volume && `Vol. ${f.volume}`,
        inbook && f.chapter && `Chap. ${f.chapter}`,
        inbook && f.pages && `pp. ${f.pages}`,
      ].filter(Boolean);
      addTitle(true, details.length > 0 ? ` (${details.join(", ")}).` : titleEnd);
      if (f.howpublished) add(endSentence(f.howpublished));
      const publisher = [f.publisher, f.address].filter(Boolean).join(", ");
      const issuer = publisher || f.organization || f.institution || f.school;
      if (issuer) add(endSentence(issuer));
    }
  }

  if (f.note) add(endSentence(f.note));
  const preprint = eprintSegment(f);
  if (preprint) add(preprint.text, preprint.href ? { href: preprint.href } : {});
  if (f.doi) add(doiUrl(f.doi), { href: doiUrl(f.doi) });
  else if (f.url) {
    const retrieved = accessed(f, apaLongDate);
    if (retrieved) add(`Retrieved ${retrieved}, from`);
    add(f.url, { href: f.url });
  }
  return segments;
}

function formatMla(entry: BibEntry, f: Fields): RefSegment[] {
  const { segments, add } = createRuns();
  const title = f.title ?? "";
  const leadNames = entry.authors.length > 0 ? entry.authors : entry.editors;
  const leadIsEditors = entry.authors.length === 0 && entry.editors.length > 0;
  const parts = (...items: (string | false | undefined)[]) => items.filter(Boolean) as string[];
  const published = pubDate(f);
  const when = published ? mlaDate(published) : undefined;
  const editedBy = entry.editors.length > 0 && entry.authors.length > 0 ? mlaEditorList(entry.editors) : "";

  if (leadNames.length > 0) {
    const role = leadIsEditors ? (leadNames.length > 1 ? ", editors" : ", editor") : "";
    add(endSentence(`${mlaNameList(leadNames)}${role}`));
  }

  // "Quoted." titles for parts of larger works, italic for standalone ones.
  const quoted = ["article", "inproceedings", "conference", "incollection", "online"].includes(entry.entryType);
  if (title) {
    if (quoted) add(`“${endSentence(title)}”`);
    else {
      add(title, { italic: true });
      add(/[.?!]$/.test(title) ? "" : ".", {}, false);
    }
  }

  // "*Container*, a, b, c." — the container is italic, the rest plain.
  const container = (name: string | undefined, rest: string[]) => {
    if (name) {
      add(name, { italic: true });
      add(`${rest.length ? ", " : ""}${endSentence(rest.join(", "))}`, {}, false);
    } else if (rest.length) add(endSentence(rest.join(", ")));
  };

  switch (entry.entryType) {
    case "article":
      container(f.journal, parts(f.volume && `vol. ${f.volume}`, f.number && `no. ${f.number}`, when, f.pages && `pp. ${f.pages}`));
      break;
    case "inproceedings":
    case "conference":
    case "incollection":
      container(
        f.booktitle,
        parts(
          editedBy && `edited by ${editedBy}`,
          f.edition && ordinalEdition(f.edition),
          f.volume && `vol. ${f.volume}`,
          f.publisher || f.organization,
          when,
          f.pages && `pp. ${f.pages}`
        )
      );
      break;
    case "phdthesis":
    case "mastersthesis":
      if (when) add(`${when}.`);
      if (f.school) add(`${f.school}, ${typeLabel(f) || (entry.entryType === "phdthesis" ? "PhD dissertation" : "MA thesis")}.`);
      break;
    case "techreport": {
      const rest = parts(f.institution, when);
      if (rest.length) add(endSentence(rest.join(", ")));
      if (f.number) add(`${typeLabel(f) || "Technical Report"} No. ${f.number}.`);
      break;
    }
    case "online": {
      // "Title." *Site*, Publisher, Date.
      const site = f.organization || f.publisher || f.institution;
      container(site, parts(f.organization && f.publisher, when));
      break;
    }
    case "patent": {
      const rest = parts(patentNumber(f), f.holder, when);
      if (rest.length) add(endSentence(rest.join(", ")));
      break;
    }
    default: {
      const rest = parts(
        f.edition && ordinalEdition(f.edition),
        f.version && `version ${f.version}`,
        f.series,
        f.volume && `vol. ${f.volume}`,
        f.publisher || f.organization || f.institution || f.school,
        when,
        entry.entryType === "inbook" && f.pages && `pp. ${f.pages}`
      );
      // The list opens a sentence: "Version 3.45.0, 2024." / "Vol. 3, Publisher, 2020."
      if (/^(version|vol\.)/.test(rest[0] ?? "")) rest[0] = rest[0][0].toUpperCase() + rest[0].slice(1);
      if (rest.length) add(endSentence(rest.join(", ")));
      if (f.howpublished) add(endSentence(f.howpublished));
    }
  }

  if (f.note) add(endSentence(f.note));
  const preprint = eprintSegment(f);
  if (preprint) {
    add(preprint.text, preprint.href ? { href: preprint.href } : {});
    add(".", {}, false);
  }
  if (f.doi) {
    add(doiUrl(f.doi), { href: doiUrl(f.doi) });
    add(".", {}, false);
  } else if (f.url) {
    add(f.url, { href: f.url });
    add(".", {}, false);
    const retrieved = accessed(f, mlaDate);
    if (retrieved) add(`Accessed ${retrieved}.`);
  }
  return segments;
}

function formatVancouver(entry: BibEntry, f: Fields): RefSegment[] {
  const { segments, add } = createRuns();
  const title = f.title ?? "";
  const leadNames = entry.authors.length > 0 ? entry.authors : entry.editors;
  const leadIsEditors = entry.authors.length === 0 && entry.editors.length > 0;
  const pages = f.pages?.replace(/[–—]/g, "-");
  const published = pubDate(f);
  const year = published ? vancouverDate(published) : "";
  // "Place: Publisher; Year."
  const imprint = (publisher: string | undefined, place: string | undefined) =>
    `${place && publisher ? `${place}: ` : ""}${publisher ?? ""}${publisher && year ? "; " : ""}${year}`;

  if (leadNames.length > 0) {
    const role = leadIsEditors ? (leadNames.length > 1 ? ", editors" : ", editor") : "";
    add(endSentence(`${vancouverNameList(leadNames)}${role}`));
  }

  switch (entry.entryType) {
    case "article": {
      if (title) add(endSentence(title));
      if (f.journal) {
        const issue = `${year}${f.volume ? `;${f.volume}` : ""}${f.number ? `(${f.number})` : ""}${pages ? `:${pages}` : ""}`;
        add(`${endSentence(f.journal)}${issue ? ` ${issue}.` : ""}`);
      }
      break;
    }
    case "inproceedings":
    case "conference":
    case "incollection": {
      if (title) add(endSentence(title));
      const editors =
        entry.editors.length > 0 && entry.authors.length > 0
          ? `In: ${vancouverNameList(entry.editors)}, editor${entry.editors.length > 1 ? "s" : ""}. `
          : "In: ";
      if (f.booktitle) add(`${editors}${endSentence(f.booktitle)}`);
      if (f.edition) add(ordinalEdition(f.edition));
      if (f.volume) add(`Vol. ${f.volume}.`);
      const published = imprint(f.publisher || f.organization, f.address);
      if (published) add(endSentence(published));
      if (pages) add(`p. ${pages}.`);
      break;
    }
    case "phdthesis":
    case "mastersthesis": {
      const kind = entry.entryType === "phdthesis" ? "Doctoral dissertation" : "Master's thesis";
      if (title) add(`${title.replace(/[.?!]$/, "")} [${typeLabel(f) || kind}].`);
      const published = imprint(f.school, f.address);
      if (published) add(endSentence(published));
      break;
    }
    case "techreport": {
      if (title) add(endSentence(title));
      const published = imprint(f.institution, f.address);
      if (published) add(endSentence(published));
      if (f.number) add(`Report No.: ${f.number}.`);
      break;
    }
    case "online": {
      if (title) add(`${title.replace(/[.?!]$/, "")} [Internet].`);
      const imprinted = imprint(f.publisher || f.organization || f.institution, f.address);
      if (imprinted) add(endSentence(imprinted));
      break;
    }
    case "software":
    case "dataset": {
      const kind = typeLabel(f) || entry.entryType;
      if (title) add(`${title.replace(/[.?!]$/, "")} [${kind}].`);
      if (f.version) add(`Version ${f.version}.`);
      const imprinted = imprint(f.publisher || f.organization || f.institution, f.address);
      if (imprinted) add(endSentence(imprinted));
      break;
    }
    case "patent": {
      if (title) add(endSentence(title));
      if (f.number) add(`${f.address ? `${f.address} ` : ""}Patent ${f.number}.`);
      if (f.holder) add(`Assignee: ${endSentence(f.holder)}`);
      if (year) add(`${year}.`);
      break;
    }
    default: {
      const inbook = entry.entryType === "inbook";
      if (title) add(endSentence(title));
      if (f.edition) add(ordinalEdition(f.edition));
      if (f.version) add(`Version ${f.version}.`);
      if (f.volume) add(`Vol. ${f.volume}.`);
      if (inbook && f.chapter) add(`Chapter ${f.chapter}.`);
      if (f.howpublished) add(endSentence(f.howpublished));
      const imprinted = imprint(f.publisher || f.organization || f.institution || f.school, f.address);
      if (imprinted) add(endSentence(imprinted));
      if (inbook && pages) add(`p. ${pages}.`);
      if (f.series) add(`(${f.series}).`);
    }
  }

  if (f.note) add(endSentence(f.note));
  const preprint = eprintSegment(f);
  if (preprint) add(preprint.text, preprint.href ? { href: preprint.href } : {});
  if (f.doi) add(`doi:${f.doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")}`, { href: doiUrl(f.doi) });
  else if (f.url) {
    const cited = accessed(f, vancouverDate);
    if (cited) add(`[cited ${cited}].`);
    add("Available from:");
    add(f.url, { href: f.url });
  }
  return segments;
}

/**
 * One entry as list text plus the strings the in-text styles and sorting need.
 * Never throws for odd entry data: an entry that cannot be formatted becomes a
 * marker, so one bad entry does not take down the page. An unknown `style` does
 * throw, since that is a configuration error.
 */
export function formatReference(
  entry: BibEntry,
  style: EnumValue<ReferenceStyle> = ReferenceStyle.APA
): FormattedReference {
  const refStyle = oneOf("reference style", ReferenceStyle, style);
  try {
    return formatEntry(entry, refStyle);
  } catch (err) {
    console.warn(`Bibliography: could not format "${entry.citeKey}"`, err);
    return {
      citeKey: entry.citeKey,
      authorYear: entry.citeKey,
      author: entry.citeKey,
      segments: [{ text: `[${entry.citeKey}: could not be formatted]` }],
      sortKey: { author: entry.citeKey.toLowerCase(), year: Number.POSITIVE_INFINITY, title: "" },
    };
  }
}

/** Drops "names" that are only punctuation or empty braces, like `,` or `{}`. */
const realNames = (names: string[]) => names.filter((n) => /[\p{L}\p{N}]/u.test(n));

function formatEntry(source: BibEntry, refStyle: ReferenceStyle): FormattedReference {
  const f = cleanFields(source);
  const entryType = canonicalType(source, f);
  // biblatex @thesis names the university `institution`; BibTeX's theses say `school`.
  if ((entryType === "phdthesis" || entryType === "mastersthesis") && !f.school && f.institution) {
    f.school = f.institution;
  }
  const entry = {
    ...source,
    entryType,
    authors: realNames(source.authors),
    editors: realNames(source.editors),
  };
  const segments =
    refStyle === ReferenceStyle.MLA
      ? formatMla(entry, f)
      : refStyle === ReferenceStyle.Vancouver
        ? formatVancouver(entry, f)
        : formatApa(entry, f);

  const title = f.title ?? "";
  const year = f.year || "n.d.";
  const leadNames = entry.authors.length > 0 ? entry.authors : entry.editors;
  // With neither a title nor a name there is nothing to find the entry by: lead with its key.
  if (!title && leadNames.length === 0) {
    segments.unshift({ text: `[${entry.citeKey}]${segments.length > 0 ? " " : ""}` });
  }
  const author = inlineNames(leadNames, refStyle) || title || entry.citeKey;
  return {
    citeKey: entry.citeKey,
    authorYear: `${author}, ${year}`,
    author,
    segments,
    sortKey: {
      author: (splitOthers(leadNames).people[0]?.family ?? title).toLowerCase(),
      year: Number.parseInt(f.year ?? "", 10) || Number.POSITIVE_INFINITY,
      title: title.toLowerCase(),
    },
  };
}

/**
 * Orders references. `refs` must already be in order of appearance; that
 * order is returned as is for ReferenceSort.Appearance.
 */
export function sortReferences(
  refs: FormattedReference[],
  sort: ReferenceSort
): FormattedReference[] {
  if (sort === ReferenceSort.Appearance) return refs;
  const byAuthor = (a: FormattedReference, b: FormattedReference) =>
    a.sortKey.author.localeCompare(b.sortKey.author);
  const byYear = (a: FormattedReference, b: FormattedReference) =>
    a.sortKey.year === b.sortKey.year ? 0 : a.sortKey.year < b.sortKey.year ? -1 : 1;
  const byTitle = (a: FormattedReference, b: FormattedReference) =>
    a.sortKey.title.localeCompare(b.sortKey.title);
  const order =
    sort === ReferenceSort.Date
      ? (a: FormattedReference, b: FormattedReference) => byYear(a, b) || byAuthor(a, b) || byTitle(a, b)
      : (a: FormattedReference, b: FormattedReference) => byAuthor(a, b) || byYear(a, b) || byTitle(a, b);
  return [...refs].sort(order);
}
