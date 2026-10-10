import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BibServerError,
  canSubmit,
  createBibEntry,
  describeBibError,
  prepareBibTeX,
} from "../bibliography-client.ts";
import { BibEntryValidationError, bibEntryProblems, newEntryId, validateBibEntry, type BibEntry } from "../bibliography.ts";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const PASTED = `@article{shannon1948,
  author  = {Shannon, Claude E.},
  title   = {A Mathematical Theory of Communication},
  journal = {Bell System Technical Journal},
  year    = {1948}
}`;

// ─── ids and the extra fields ─────────────────────────────────────────────────

test("newEntryId makes version 4 UUIDs", () => {
  const ids = new Set(Array.from({ length: 50 }, newEntryId));
  assert.equal(ids.size, 50);
  for (const id of ids) assert.match(id, UUID_V4);
});

test("newEntryId works without crypto.randomUUID", () => {
  const original = globalThis.crypto.randomUUID;
  try {
    Object.defineProperty(globalThis.crypto, "randomUUID", { value: undefined, configurable: true });
    assert.match(newEntryId(), UUID_V4);
  } finally {
    Object.defineProperty(globalThis.crypto, "randomUUID", { value: original, configurable: true });
  }
});

test("validateBibEntry carries id, rawSource and the server's times, and checks them", () => {
  const base = { citeKey: "k", entryType: "misc", fields: {}, authors: [], editors: [] };
  const id = newEntryId().toUpperCase();
  const v = validateBibEntry({ ...base, id, rawSource: "@misc{k}", createdAt: "2026-01-01T00:00:00Z", lastModified: "2026-01-02T00:00:00Z" });
  assert.equal(v.id, id.toLowerCase());
  assert.equal(v.rawSource, "@misc{k}");
  assert.equal(v.createdAt, "2026-01-01T00:00:00Z");
  assert.equal("id" in validateBibEntry(base), false, "absent stays absent");
  for (const bad of [{ id: "nope" }, { id: 5 }, { rawSource: 5 }, { createdAt: {} }]) {
    assert.throws(() => validateBibEntry({ ...base, ...bad }), BibEntryValidationError);
  }
});

// ─── bibEntryProblems ─────────────────────────────────────────────────────────

const entry = (over: Partial<BibEntry> = {}): BibEntry => ({
  citeKey: "k", entryType: "misc", fields: { title: "T" }, authors: [], editors: [], ...over,
});

test("bibEntryProblems accepts a good entry and explains the bad ones", () => {
  assert.deepEqual(bibEntryProblems(entry()), []);
  assert.deepEqual(bibEntryProblems(entry({ fields: {}, authors: ["Doe, Jane"] })), []);
  assert.match(bibEntryProblems(entry({ fields: { note: "n" } })).join(), /title or at least one author/);
  assert.match(bibEntryProblems(entry({ fields: { title: "  " } })).join(), /title or at least one author/);
  assert.match(bibEntryProblems(entry({ citeKey: "a b" })).join(), /cite key/);
  assert.match(bibEntryProblems(entry({ citeKey: "k".repeat(256) })).join(), /cite key/);
  assert.match(bibEntryProblems(entry({ citeKey: "" })).join(), /cite key/);
  assert.match(bibEntryProblems(entry({ entryType: "my-type" })).join(), /entry type/);
  assert.match(bibEntryProblems(entry({ fields: { title: "x".repeat(50_001) } })).join(), /"title" is too long/);
  assert.match(bibEntryProblems(entry({ authors: ["x".repeat(1_001)] })).join(), /name is too long/);
});

// ─── prepareBibTeX ────────────────────────────────────────────────────────────

test("prepareBibTeX gives each entry its own id and keeps what was pasted", () => {
  const prepared = prepareBibTeX(`${PASTED}\n@misc{other, title={Other}}`);
  assert.equal(prepared.entries.length, 2);
  const [first, second] = prepared.entries.map((e) => e.entry);
  assert.match(first.id!, UUID_V4);
  assert.notEqual(first.id, second.id);
  assert.equal(first.rawSource, PASTED);
  assert.ok(canSubmit(prepared));
});

test("prepareBibTeX reports entries it cannot read, and entries the server would refuse", () => {
  const broken = prepareBibTeX("@article{a, title = {never closed");
  assert.equal(broken.errors.length, 1);
  assert.equal(canSubmit(broken), false);

  const untitled = prepareBibTeX("@misc{x, note={just a note}}");
  assert.equal(untitled.entries.length, 1);
  assert.match(untitled.entries[0].problems.join(), /title or at least one author/);
  assert.equal(canSubmit(untitled), false);

  assert.equal(canSubmit(prepareBibTeX("")), false, "nothing to send");
  assert.equal(canSubmit(prepareBibTeX("just some words")), false);
});

test("a crossref is resolved, so what is sent is complete", () => {
  const prepared = prepareBibTeX("@inproceedings{c, title={T}, crossref={p}}\n@proceedings{p, title={Proc}, publisher={ACM}}");
  const child = prepared.entries.find((e) => e.entry.citeKey === "c")!.entry;
  assert.equal(child.fields.booktitle, "Proc");
  assert.equal(child.fields.publisher, "ACM");
  assert.equal(child.fields.crossref, "p", "the crossref itself is kept");
});

// ─── createBibEntry ───────────────────────────────────────────────────────────

interface Call { url: string; init: RequestInit }
function fakeServer(respond: (body: any) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return respond(JSON.parse(init.body as string));
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}
const stored = (body: any) => ({ ...body, createdAt: "2026-10-07T12:00:00Z", lastModified: "2026-10-07T12:00:00Z" });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

test("createBibEntry posts the entry and returns it as stored", async () => {
  const { calls, fetchImpl } = fakeServer((body) => json(stored(body)));
  const { entry: prepared } = prepareBibTeX(PASTED).entries[0];
  // Even if the entry carries times (say, copied from a stored one), they are not sent.
  const result = await createBibEntry(
    { ...prepared, createdAt: "x", lastModified: "y" },
    { baseUrl: "https://api.example.org/", fetch: fetchImpl, headers: () => ({ Authorization: "Bearer t" }) }
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.example.org/update_bibtex");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.credentials, "include");
  const headers = calls[0].init.headers as Headers;
  assert.equal(headers.get("content-type"), "application/json");
  assert.equal(headers.get("authorization"), "Bearer t");

  const sent = JSON.parse(calls[0].init.body as string);
  assert.equal(sent.id, prepared.id);
  assert.equal(sent.citeKey, "shannon1948");
  assert.equal(sent.rawSource, PASTED);
  assert.equal("createdAt" in sent, false);
  assert.equal("lastModified" in sent, false);

  assert.equal(result.createdAt, "2026-10-07T12:00:00Z");
  assert.equal(result.id, prepared.id);
});

test("createBibEntry makes an id if the entry has none", async () => {
  const { calls, fetchImpl } = fakeServer((body) => json(stored(body)));
  await createBibEntry(entry(), { fetch: fetchImpl });
  assert.match(JSON.parse(calls[0].init.body as string).id, UUID_V4);
  assert.equal(calls[0].url, "/update_bibtex", "same origin by default");
});

test("createBibEntry refuses a bad entry without sending it", async () => {
  const { calls, fetchImpl } = fakeServer((body) => json(stored(body)));
  await assert.rejects(createBibEntry(entry({ fields: {} }), { fetch: fetchImpl }), /needs a title|title or at least one author/);
  await assert.rejects(createBibEntry({ ...entry(), id: "not-a-uuid" }, { fetch: fetchImpl }), BibEntryValidationError);
  assert.equal(calls.length, 0);
});

test("createBibEntry turns the server's refusals into BibServerError", async () => {
  for (const [status, code, message] of [
    [409, "key_in_use", 'Cite key "k" is already used by another entry'],
    [422, "invalid_entry", "an entry needs a title or at least one author or editor"],
    [400, "invalid_user", "Invalid User ID"],
  ] as const) {
    const { fetchImpl } = fakeServer(() => json({ error: code, message }, status));
    await assert.rejects(createBibEntry(entry(), { fetch: fetchImpl }), (err: unknown) => {
      assert.ok(err instanceof BibServerError);
      assert.equal(err.status, status);
      assert.equal(err.code, code);
      assert.equal(err.message, message);
      return true;
    });
  }
  // A reply that is not the server's JSON still gives a useful error.
  const { fetchImpl } = fakeServer(() => new Response("<html>Bad Gateway</html>", { status: 502, statusText: "Bad Gateway" }));
  await assert.rejects(createBibEntry(entry(), { fetch: fetchImpl }), (err: unknown) => {
    assert.ok(err instanceof BibServerError);
    assert.equal(err.code, "http_error");
    assert.match(err.message, /502/);
    return true;
  });
});

test("createBibEntry reports an unreachable server, and a reply for the wrong entry", async () => {
  const down = (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch;
  await assert.rejects(createBibEntry(entry(), { fetch: down }), (err: unknown) => {
    assert.ok(err instanceof BibServerError);
    assert.equal(err.status, 0);
    assert.equal(err.code, "network");
    return true;
  });

  const { fetchImpl } = fakeServer((body) => json(stored({ ...body, citeKey: "other" })));
  await assert.rejects(createBibEntry(entry(), { fetch: fetchImpl }), /was sent/);
  const bad = fakeServer(() => json({ nope: true }));
  await assert.rejects(createBibEntry(entry(), { fetch: bad.fetchImpl }), BibEntryValidationError);
});

test("describeBibError says something a person can act on", () => {
  assert.match(describeBibError(new BibServerError(409, "key_in_use", "x")), /already used/);
  assert.match(describeBibError(new BibServerError(0, "network", "Could not reach the server (x)")), /Could not reach/);
  assert.equal(describeBibError(new BibServerError(500, "internal", "internal error")), "internal error");
  assert.equal(describeBibError(new Error("boom")), "boom");
});
