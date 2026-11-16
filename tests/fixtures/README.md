# Conformance fixtures

`conformance.json` is built by `python3 tools/build_spec_fixtures.py <dir>` from these published test suites. The
tests that use it are `tests/conformance.test.ts` (REQ-301 to REQ-307). Each case holds the Markdown, the HTML the suite
expects, its suite and section, and `html_in_source`, which is true when the input needs raw HTML parsed (vfm shows HTML as
text, so those cases are left out, REQ-022).

| Suite | Cases | Source | License |
| --- | ---: | --- | --- |
| CommonMark 0.31.2 | 652 | <https://spec.commonmark.org/0.31.2/spec.json> | the spec is CC-BY-SA 4.0, © 2014-16 John MacFarlane ([LICENSE](https://github.com/commonmark/commonmark-spec/blob/master/LICENSE)) |
| GFM spec 0.29, extension sections (tables, task lists, strikethrough, autolinks) | 23 | <https://github.com/github/cmark-gfm/blob/master/test/spec.txt> | CC-BY-SA 4.0 |
| cmark-gfm `extensions.txt` (tables, strikethrough, autolinks, footnotes, interop, task lists) | 29 | <https://github.com/github/cmark-gfm/blob/master/test/extensions.txt> | BSD-2-Clause, © 2014 John MacFarlane ([COPYING](https://github.com/github/cmark-gfm/blob/master/COPYING)) |
| markdown-it `commonmark_extras`, `tables`, `strikethrough` | 73 + 38 + 15 | <https://github.com/markdown-it/markdown-it/tree/master/test/fixtures/markdown-it> | MIT, © 2014 Vitaly Puzrin, Alex Kocharin |

Left out on purpose: markdown-it's `linkify` and `smartquotes` (options vfm does not offer), and cmark-gfm's "HTML tag filter" (raw HTML).

`known-divergences.json` is the ledger of every case that is run and differs, with a kind and a reason (see its `_doc`). To refresh the
fixtures, download the files above, run the build tool and run `npm test`: a new difference fails the run until it is fixed or
written into the ledger with its reason.

## What the comparison ignores

`tests/helpers/normalizeHtml.ts` reduces both sides to a canonical form. It ignores what vfm adds on purpose and a reader does not see
as a difference (REQ-301 lists none of these as divergences): attributes other than `href`, `src`, `alt`, `title`, `start`, `checked`,
`align`, `colspan` and the language class; numbered `figure`/`figcaption`/`caption` wrappers; `thead`/`tbody`; `div.blockquote` for
`blockquote`; `s` for `del`; highlighting spans in code; the newline that ends code text; the paragraph around a lone image; and white space.
It keeps text, element names and order, so a missing paragraph, list, link or emphasis is a difference.
