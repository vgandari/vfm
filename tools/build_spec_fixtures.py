#!/usr/bin/env python3
"""Builds tests/fixtures/conformance.json from the published test suites of the flavors vfm builds on.

Usage: python3 tools/build_spec_fixtures.py <dir>, where <dir> holds the downloaded files (URLs in
tests/fixtures/README.md). Each case is {id, suite, section, markdown, html}. Only examples written for
vfm's own scope are kept: CommonMark core, GFM extensions (tables, task lists, strikethrough, autolinks,
footnotes), and markdown-it's extras. Raw-HTML examples are kept but flagged `html: true` so the harness
can leave them out (vfm shows HTML as text by design).
"""
import json, re, sys, pathlib

src = pathlib.Path(sys.argv[1])
out = pathlib.Path(__file__).resolve().parent.parent / "tests/fixtures/conformance.json"
cases = []


def add(cid, suite, section, md, html):
    cases.append({"id": cid, "suite": suite, "section": section, "markdown": md, "html": html})


# CommonMark 0.31.2 (spec.json is generated from the spec by its own tool)
for e in json.loads((src / "spec.json").read_text(encoding="utf8")):
    add(f"cm-{e['example']}", "CommonMark 0.31.2", e["section"], e["markdown"], e["html"])

FENCE = re.compile(r"^`{32} example(?: .*)?$")


def spec_txt(path, suite, prefix, keep):
    section, n, lines, i = "", 0, path.read_text(encoding="utf8").split("\n"), 0
    while i < len(lines):
        ln = lines[i]
        m = re.match(r"^#{1,3} (.*)", ln)
        if m and not FENCE.match(ln):
            section = m.group(1).strip()
        if FENCE.match(ln):
            i += 1
            md, html, cur = [], [], None
            cur = md
            while not lines[i].startswith("`" * 32):
                if lines[i] == "." and cur is md:
                    cur = html
                else:
                    cur.append(lines[i])
                i += 1
            n += 1
            if keep(section):
                add(f"{prefix}-{n}", suite, section, "\n".join(md).replace("→", "\t") + "\n", "\n".join(html).replace("→", "\t") + ("\n" if html else ""))
        i += 1


GFM_EXT = {"Tables (extension)", "Task list items (extension)", "Strikethrough (extension)", "Autolinks (extension)"}
spec_txt(src / "gfm_spec.txt", "GFM spec 0.29", "gfm", lambda s: s in GFM_EXT)
spec_txt(src / "test_extensions.txt", "cmark-gfm extensions", "cmarkgfm", lambda s: not s.startswith(("HTML tag filter",)))


def dotted(path, suite, prefix):
    """markdown-it's format: an optional title line, then `.`, input, `.`, output, `.` (a line holding one dot is the separator)."""
    chunks = re.split(r"(?m)^\.$\n?", path.read_text(encoding="utf8"))
    for k, i in enumerate(range(1, len(chunks) - 1, 3), 1):
        title = chunks[i - 1].strip().split("\n")[-1].strip().rstrip(":") if i > 1 or chunks[0].strip() else ""
        add(f"{prefix}-{k}", suite, title or "untitled", chunks[i], chunks[i + 1])


dotted(src / "test_fixtures_markdown-it_commonmark_extras.txt", "markdown-it commonmark_extras", "mdit-extras")
dotted(src / "test_fixtures_markdown-it_tables.txt", "markdown-it tables", "mdit-tables")
dotted(src / "test_fixtures_markdown-it_strikethrough.txt", "markdown-it strikethrough", "mdit-strike")

# A case "needs raw HTML" when its input holds an HTML tag, comment, declaration, processing instruction or CDATA.
# An autolink (<https://x.y>, <a@b.c>) is not HTML.
TAG = re.compile(r"</?[A-Za-z][^<>]*>|<!--|<\?|<!\[CDATA\[|<![A-Za-z]")
AUTOLINK = re.compile(r"<(?:[A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*|[^\s<>@\\]+@[^\s<>]+)>")
for c in cases:
    c["html_in_source"] = bool(TAG.search(AUTOLINK.sub("", c["markdown"])))
out.write_text(json.dumps(cases, indent=1, ensure_ascii=False) + "\n", encoding="utf8")
import collections
print(len(cases), "cases", dict(collections.Counter(c["suite"] for c in cases)))
print(sum(c["html_in_source"] for c in cases), "contain raw HTML")
