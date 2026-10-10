/**
 * bibliography-client.ts
 *
 * Adding references from the browser: paste BibTeX, check it, send it to the
 * server.
 *
 *   prepareBibTeX(text)      parses the text, gives every entry a new UUID, and lists
 *                            what is wrong with it (nothing is sent)
 *   createBibEntry(entry)    POSTs one entry to the server's `/update_bibtex`
 *
 * The server stores what it is sent and sets `createdAt` and `lastModified` itself.
 * An entry is created, not overwritten: its id is new, so the server refuses (409)
 * a cite key that is already taken. Sending the same prepared entry again (after a
 * network error, say) is safe: the same id updates the entry it already created.
 *
 * Client-safe: no Node imports.
 */

import { parseBibTeX, type BibTeXParseError } from "./bibtex";
import {
  BibEntryValidationError,
  bibEntryProblems,
  newEntryId,
  validateBibEntry,
  type BibEntry,
} from "./bibliography";

// ─── Checking pasted text ─────────────────────────────────────────────────────

export interface PreparedEntry {
  /** Ready to send: it has an id. */
  entry: BibEntry;
  /** Why the server would refuse it; empty when it is fine. */
  problems: string[];
}

export interface PreparedBibTeX {
  entries: PreparedEntry[];
  /** Entries that could not be read and were skipped, with line and column. */
  errors: BibTeXParseError[];
  /** Entries that were read but have something odd, such as a crossref to nothing. */
  warnings: BibTeXParseError[];
}

/**
 * Parses pasted BibTeX. Every entry gets a new random id here, once, so that the
 * same prepared entry can be sent again without creating a second copy.
 *
 * `crossref` is resolved while parsing (the entry gets the fields it inherits), so
 * what is sent is complete in itself. `rawSource` keeps the entry as it was pasted.
 */
export function prepareBibTeX(text: string): PreparedBibTeX {
  const { entries, errors, warnings } = parseBibTeX(text);
  return {
    entries: entries.map((parsed) => {
      const entry: BibEntry = { ...parsed, id: newEntryId() };
      return { entry, problems: bibEntryProblems(entry) };
    }),
    errors,
    warnings,
  };
}

/** True when there is something to send and nothing is wrong with any of it. */
export function canSubmit(prepared: PreparedBibTeX): boolean {
  return (
    prepared.entries.length > 0 &&
    prepared.errors.length === 0 &&
    prepared.entries.every((e) => e.problems.length === 0)
  );
}

// ─── Sending ──────────────────────────────────────────────────────────────────

/** The server said no (or could not be reached). `code` is its `error`, such as "key_in_use". */
export class BibServerError extends Error {
  constructor(
    /** HTTP status; 0 when the server could not be reached. */
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "BibServerError";
  }
}

export interface BibServerConfig {
  /** Where the server is, without a trailing slash. Default: the page's own origin. */
  baseUrl?: string;
  /** Default "include": the session cookie goes with the request. */
  credentials?: RequestCredentials;
  /** Extra headers, for instance `Authorization`. Called for every request. */
  headers?: () => HeadersInit | Promise<HeadersInit>;
  fetch?: typeof fetch;
}

/**
 * Sends one entry to the server to be created and returns it as stored, with its
 * `createdAt` and `lastModified`. Throws BibEntryValidationError, without sending
 * anything, if the entry is not fit to send, and BibServerError if the server
 * refuses it. The entry's own `createdAt` and `lastModified` are never sent.
 */
export async function createBibEntry(entry: BibEntry, config: BibServerConfig = {}): Promise<BibEntry> {
  // The server sets the times. A missing id is made here.
  const { createdAt: _createdAt, lastModified: _lastModified, ...rest } = entry;
  const outgoing = validateBibEntry({ ...rest, id: entry.id ?? newEntryId() });
  const problems = bibEntryProblems(outgoing);
  if (problems.length > 0) throw new BibEntryValidationError(outgoing.citeKey, problems.join("; "));

  const headers = new Headers(config.headers ? await config.headers() : undefined);
  headers.set("Content-Type", "application/json");

  let res: Response;
  try {
    res = await (config.fetch ?? fetch)(`${(config.baseUrl ?? "").replace(/\/+$/, "")}/update_bibtex`, {
      method: "POST",
      credentials: config.credentials ?? "include",
      headers,
      body: JSON.stringify(outgoing),
    });
  } catch (err) {
    throw new BibServerError(0, "network", `Could not reach the server (${(err as Error).message})`);
  }

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new BibServerError(
      res.status,
      typeof body?.error === "string" ? body.error : "http_error",
      typeof body?.message === "string" ? body.message : `${res.status} ${res.statusText}`.trim()
    );
  }

  const stored = validateBibEntry(await res.json());
  if (stored.citeKey !== outgoing.citeKey) {
    throw new BibEntryValidationError(
      "citeKey",
      `is "${stored.citeKey}", but "${outgoing.citeKey}" was sent`
    );
  }
  return stored;
}

/** A sentence for the person at the keyboard. */
export function describeBibError(err: unknown): string {
  if (err instanceof BibServerError) {
    switch (err.code) {
      case "key_in_use":
        return "That cite key is already used by another of your references.";
      case "id_in_use":
        return "That id is already in use.";
      case "invalid_entry":
        return `The server rejected the entry: ${err.message}`;
      case "invalid_user":
        return "You are not signed in.";
      case "network":
        return err.message;
    }
    return err.message;
  }
  return err instanceof Error ? err.message : String(err);
}
