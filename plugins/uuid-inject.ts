/**
 * plugins/uuid-inject.ts
 *
 * Raw-source preprocessor that injects a component UUID into all labels,
 * cross-references, and footnotes so that labels are globally unique when
 * multiple MarkdownRenderer components appear on the same page.
 *
 * When id is null, the source is returned unchanged.
 *
 * Transforms applied to the raw source string:
 *
 *   Labels:       {#type:label}      → {#UUID-type:label}
 *   Cross-refs:   [@type:label]      → [@UUID-type:label]
 *                 (only if no UUID prefix is already present)
 *   Footnotes:    [^label]           → [^UUID-label]   (both ref and definition)
 *
 * UUID v4 pattern used for detection:
 *   [0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}
 *
 * FIX: The original CODE_RE matched entire fenced code blocks (opening fence +
 * body + closing fence) as a single opaque token. This caused the info string
 * (the part after the language name on the opening fence line, e.g.
 * "Fibonacci. {#lst:fib}") to be treated as code and skipped, so label tokens
 * in info strings were never UUID-injected. Meanwhile, cross-references in
 * body text were injected, producing a key mismatch: the registry stored
 * "lst:fib" but lookups used "UUID-lst:fib".
 *
 * The fix splits fenced code blocks into three parts:
 *   1. Opening fence line (including info string) — transformed normally
 *   2. Body (everything between the fences)       — skipped (isCode: true)
 *   3. Closing fence line                         — skipped
 *
 * Inline code spans (backtick-delimited, no newline) are still skipped in
 * their entirety as before.
 */

const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;

function isUuidPrefixed(label: string): boolean {
  return UUID_V4_RE.test(label);
}

// ─── Source segmenter ─────────────────────────────────────────────────────────
//
// Splits source text into segments, each tagged as code (skip transforms) or
// normal (apply transforms).
//
// Segments produced:
//   - Inline code (`...`): one isCode segment for the whole span
//   - Fenced code block:
//       • opening fence line (``` lang info-string\n): isCode=false so the
//         info string gets UUID-injected
//       • body + closing fence: isCode=true
//   - Everything else: isCode=false

interface Segment {
  text: string;
  isCode: boolean;
}

function segmentSource(source: string): Segment[] {
  const segments: Segment[] = [];

  // Matches either:
  //   A) A fenced code block: captured in groups 1-3
  //      group 1: opening fence line including trailing newline
  //               e.g. "```python Fibonacci. {#lst:fib}\n"
  //      group 2: body + closing fence
  //               e.g. "def fib():\n    pass\n```"
  //   B) An inline code span: captured in group 3
  //      e.g. "`inline code`"
  //
  // The fenced block branch uses a non-greedy body so it stops at the first
  // closing fence of the same length as the opening fence. We capture the
  // opening fence characters (backtick run) so we can build the closing fence
  // pattern — but since JS doesn't support backreferences in the same regex
  // position, we use a two-step approach: match the full block with a loose
  // pattern and post-process in the replacer.
  //
  // Loose fenced block pattern: opening line then body+close in one capture.
  // We rely on [\s\S]*? being non-greedy and the close fence being at the
  // start of a line.
  const TOKEN_RE = /((`{3,})[^\n]*\n)([\s\S]*?\2[ \t]*(?:\n|$))|(`[^`\n]*`)/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = TOKEN_RE.exec(source)) !== null) {
    // Text before this token
    if (match.index > lastIndex) {
      segments.push({ text: source.slice(lastIndex, match.index), isCode: false });
    }

    if (match[4] !== undefined) {
      // Inline code span — skip entirely
      segments.push({ text: match[4], isCode: true });
    } else {
      // Fenced code block
      // match[1] = opening fence line (e.g. "```python Caption {#lst:fib}\n")
      // match[3] = body + closing fence
      segments.push({ text: match[1], isCode: false }); // info string: transform
      segments.push({ text: match[3] ?? "", isCode: true }); // body: skip
    }

    lastIndex = match.index + match[0].length;
  }

  // Remainder
  if (lastIndex < source.length) {
    segments.push({ text: source.slice(lastIndex), isCode: false });
  }

  return segments;
}

// ─── Transform a single non-code segment ─────────────────────────────────────

function transformSegment(text: string, id: string): string {
  // 1. Labels: {#type:label} → {#UUID-type:label}
  //    fullKey is everything inside {#...}, e.g. "fig:diagram" or "eq:sum1"
  //    or already-prefixed "UUID-fig:diagram".
  //    isUuidPrefixed tests from position 0, so a UUID-prefixed key like
  //    "8238ea2c-...-fig:diagram" will match and be left alone.
  text = text.replace(/\{#([^\]:}]+:[^}]+)\}/g, (m, fullKey) => {
    if (isUuidPrefixed(fullKey)) return m;
    return `{#${id}-${fullKey}}`;
  });

  // 2. Cross-references: [@type:label] → [@UUID-type:label]
  text = text.replace(/\[@([^\]:]+:[^\]]+)\]/g, (m, labelKey) => {
    if (isUuidPrefixed(labelKey)) return m;
    return `[@${id}-${labelKey}]`;
  });

  // 3. Footnote references: [^label] (not followed by :)
  text = text.replace(/\[\^([^\]]+)\](?!:)/g, (m, label) => {
    if (isUuidPrefixed(label)) return m;
    return `[^${id}-${label}]`;
  });

  // 4. Footnote definitions: [^label]:
  text = text.replace(/^\[\^([^\]]+)\]:/gm, (m, label) => {
    if (isUuidPrefixed(label)) return m;
    return `[^${id}-${label}]:`;
  });

  return text;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function injectUuid(source: string, id: string | null): string {
  if (!id) return source;

  const segments = segmentSource(source);
  return segments
    .map(({ text, isCode }) => (isCode ? text : transformSegment(text, id)))
    .join("");
}