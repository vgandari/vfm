/**
 * bibliography-server.ts
 *
 * Server-only half of bibliography support (imports node:fs, so never import
 * it from client code). A host that keeps its references in a .bib file:
 *
 *   const bib = createBibFile("/abs/path/references.bib");
 *
 *   - bib.resolve                    BibResolver for StaticMarkdownRenderer
 *                                    (build/render time, no HTTP involved)
 *   - createBibRoute(bib)            GET handler + generateStaticParams for a
 *                                    `/api/bib/[key]` route, which is what the
 *                                    client-side MarkdownRenderer fetches
 *
 * Both go through the same lookup, so they always agree.
 */

import fs from "node:fs";
import type { BibEntry, BibResolver } from "./bibliography";
import { parseBibTeX, type BibTeXParseError, type ParsedBibTeX } from "./bibtex";

export type BibLookup =
  | { status: "ok"; entry: BibEntry }
  | { status: "not-found" }
  | { status: "malformed"; message: string };

export interface BibFile {
  lookup(key: string): BibLookup;
  keys(): string[];
  /** For StaticMarkdownRenderer. Null for an unknown key; throws if the entry is malformed. */
  resolve: BibResolver;
}

interface Loaded {
  mtimeMs: number;
  parsed: ParsedBibTeX;
  /** By cite key. */
  byKey: Map<string, BibEntry>;
  /** Skipped entries whose key is known, by cite key. */
  failedByKey: Map<string, BibTeXParseError>;
}

const EMPTY: Loaded = {
  mtimeMs: 0,
  parsed: { entries: [], errors: [], warnings: [] },
  byKey: new Map(),
  failedByKey: new Map(),
};

/** Reads and parses `filePath`, re-parsing when it changes so dev picks up edits. */
export function createBibFile(filePath: string): BibFile {
  let cache: Loaded | null = null;

  function load(): Loaded {
    let mtimeMs: number;
    try {
      mtimeMs = fs.statSync(filePath).mtimeMs;
    } catch {
      console.warn(`Bibliography: ${filePath} not found; every @cite will be unresolved`);
      return EMPTY;
    }
    if (cache?.mtimeMs === mtimeMs) return cache;

    const parsed = parseBibTeX(fs.readFileSync(filePath, "utf8"));
    for (const err of parsed.errors) console.warn(`Bibliography: ${filePath}: ${err.message}`);
    for (const warning of parsed.warnings) console.warn(`Bibliography: ${filePath}: ${warning.message}`);
    cache = {
      mtimeMs,
      parsed,
      byKey: new Map(parsed.entries.map((e) => [e.citeKey, e])),
      failedByKey: new Map(
        parsed.errors.flatMap((e) => (e.citeKey ? [[e.citeKey, e] as const] : []))
      ),
    };
    return cache;
  }

  function lookup(key: string): BibLookup {
    const { byKey, failedByKey } = load();
    const entry = byKey.get(key);
    if (entry) return { status: "ok", entry };
    const error = failedByKey.get(key);
    return error ? { status: "malformed", message: error.message } : { status: "not-found" };
  }

  return {
    lookup,
    keys: () => load().parsed.entries.map((e) => e.citeKey),
    resolve: async (key) => {
      const result = lookup(key);
      if (result.status === "malformed") {
        throw new Error(`entry "${key}" is malformed: ${result.message}`);
      }
      return result.status === "ok" ? result.entry : null;
    },
  };
}

/**
 * Handlers for a Next.js route `app/api/bib/[key]/route.ts`:
 *
 *   GET /api/bib/<key>  200 entry JSON · 404 unknown key · 422 malformed entry
 *
 * In that file also `export const dynamic = "force-static"` (it has to be a
 * literal there) to emit one JSON file per key at build time.
 */
export function createBibRoute(bib: BibFile) {
  return {
    generateStaticParams: () => bib.keys().map((key) => ({ key })),

    GET: async (_req: Request, { params }: { params: Promise<{ key: string }> }) => {
      const { key: rawKey } = await params;
      let key = rawKey;
      try {
        key = decodeURIComponent(rawKey);
      } catch {
        // Not valid percent-encoding: use it as written.
      }

      const result = bib.lookup(key);
      switch (result.status) {
        case "ok":
          return Response.json(result.entry);
        case "malformed":
          return Response.json({ error: "malformed_entry", message: result.message }, { status: 422 });
        default:
          return Response.json({ error: "not_found", message: `No entry "${key}"` }, { status: 404 });
      }
    },
  };
}
