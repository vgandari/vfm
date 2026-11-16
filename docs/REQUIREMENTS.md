# Requirements

`vfm` is the core library: it parses Markdown, builds documents and slides, and renders them. The editor extension
`vfm-preview` (`../vfm-preview`) is a client of it and keeps its own requirements. A requirement lives in exactly one
of the two repositories. IDs are unique across the two repositories. YAML front matter is the host's to read: vfm receives what it needs as arguments of
its components (for example `bibliography`, `citations`, `sourceMap`, `resolveUrl`, `measure`), except for the slide
keys it reads from the content itself (`title`, `theme-color`, `title-image`, …).

Style: NASA Systems Engineering Handbook. Each requirement is one verifiable "shall" statement. Verification
methods: **T**est, **I**nspection, **D**emonstration. Use cases are in `USE_CASES.md`; the mapping between use
cases, requirements and test cases is in `../MAPPING.json`, checked by `python3 tools/check_mapping.py`.

## A. Inferred from existing behavior

### Document and slide views

| ID | Requirement | UC | Source |
| --- | --- | --- | --- |
| REQ-004 | vfm shall render the content of every `@slide … @end` block as part of the document, and shall omit blocks marked `nodoc`. | UC-03 | spec "Overview" |
| REQ-005 | vfm shall build, from the `@slide` blocks only, one or more 1280×720 slides per block, in source order. | UC-03 | spec "Overview" |
| REQ-006 | vfm shall support the layouts `rtext`, `ltext` and `2col` and shall treat the absence of a layout as a single column. | UC-03 | spec "Syntax" |
| REQ-007 | vfm shall replace an `@include(path)` line with the text that the `read` function of `IncludeOptions` returns for that path before parsing, and shall report a cycle or an unreadable path as a diagnostic. | UC-03 | vfm README `includes.ts` |
| REQ-008 | vfm shall end the current slide at a document separator (`---`, `***`) inside a `@slide` block and shall not display the separator. | UC-03 | vfm README |
| REQ-009 | vfm shall make slide 1 from the YAML header's `title`, `subtitle`, authors, affiliations and `date` when a `title` exists. | UC-28 | vfm README "Title slide" |
| REQ-010 | vfm shall number slides from 1, counting the title slide, and shall show the number in the lower right corner of every slide except the title slide. | UC-28 | vfm README, `update.md` |
| REQ-011 | vfm shall place content in whole units and shall not change type size to make room, except that it shall scale a lone float down to at most half size. | UC-03 | vfm README "What does not fit" |
| REQ-012 | vfm shall split a table that has a header row and is too tall across slides by rows, repeating the header. | UC-03 | vfm README |
| REQ-013 | vfm shall reveal list items one per step under `steplists` and the lead-in on the last step under `stepleadin`. | UC-28 | spec "Reveal steps" |
| REQ-014 | vfm shall reduce a paragraph inside a `@slide` block to slide text by selecting and deleting sentences only, never by rewriting, unless the mode is `paragraphs: full`. | UC-12 | vfm README |
| REQ-015 | vfm shall treat sentence-ending punctuation followed by a line break as the only sentence boundary. | UC-12 | `update.md` |

### Citations, labels, blocks

| ID | Requirement | UC | Source |
| --- | --- | --- | --- |
| REQ-016 | vfm shall resolve `@cite(key)` and `@cite(a, b)` against the entries of the `bibliography` argument (a map from key to entry) of its components, formatted as the `citations` argument says. | UC-30 | README "Citations" |
| REQ-019 | vfm shall number labelled headings, figures, tables, listings, equations, algorithms and scores and shall replace `[@label]` with a link showing the number. | UC-05 | vfm README |
| REQ-020 | In slide mode vfm shall number only items that a surviving cross-reference points to, consecutively across the deck. | UC-05 | vfm README "Numbering" |
| REQ-021 | vfm shall render fenced blocks with the language `alg`, `mus` or `mermaid` as an algorithm, a score with a Play button, or a diagram numbered as a figure. | UC-06 | vfm README |
| REQ-022 | vfm shall display raw HTML as text and shall keep HTML comments invisible. | UC-03 | vfm README "No raw HTML" |

### Bibliography, footnotes, syntax, music (found while mapping the existing tests)

| ID | Requirement | UC | Source |
| --- | --- | --- | --- |
| REQ-034 | vfm shall parse BibTeX entries of any type and field, resolve `crossref` and biblatex aliases without overwriting fields, keep each entry's source text, and report a repeated key, an unreadable entry or a bad crossref. | UC-30 | `bibtex.ts` |
| REQ-035 | vfm shall format a reference in APA, MLA or Vancouver style for each entry type, and shall not fail or leave stray punctuation when fields are missing. | UC-30 | `bibliography.ts` |
| REQ-036 | vfm shall resolve each cited key once, treating keys as case-sensitive, and shall validate each entry it receives. | UC-30 | `bibliography.ts` |
| REQ-037 | vfm shall validate an entry before sending it to the user's own server, send nothing for an invalid one, and describe a refusal or an unreachable server in words the author can act on. | UC-30 | `bibliography-client.ts` |
| REQ-038 | vfm shall play a score by reading the notes abcjs writes for the tune, following repeats, without loading anything from the network. | UC-06 | `music-audio.ts` |
| REQ-039 | In slide mode vfm shall show a footnote only on a slide whose text cites it, only when it is defined inside that slide's `@slide` block, numbered from 1 on that slide. | UC-03 | vfm README "Footnotes" |
| REQ-040 | vfm shall render `~text~` as underline and `~~text~~` as strikethrough, and shall leave a lone tilde as text. | UC-29 | vfm README |

## B. New in `slide-polish`

### Theme color (UC-35)

| ID | Requirement | Method |
| --- | --- | --- |
| REQ-101 | When the YAML header holds `theme-color` with a valid CSS color, vfm shall draw the rule below every slide title in that color. | T |
| REQ-102 | When `theme-color` is valid, vfm shall fill the background of every section slide (divider, unless `section-color` is set) with exactly the theme color, with no tint, and shall draw its text as REQ-206 says. | T |
| REQ-103 | vfm shall accept `#rgb`, `#rrggbb`, `rgb()`, `hsl()` and CSS color names as `theme-color`, and shall pass no other text to the stylesheet. | T |
| REQ-104 | When `theme-color` is present and not valid, vfm shall use the default colors and shall report a diagnostic with code `theme-color` and the line of the header. | T |
| REQ-105 | When `theme-color` is absent, vfm shall render slides with the default colors, identical to the previous release. | T |
| REQ-107 | When `theme-color` is valid and `title-image` is absent, vfm shall fill the background of the title slide with exactly the theme color, with no tint, and shall draw its text as REQ-206 says. | T |

### Affiliations on the title slide (UC-14)

| ID | Requirement | Method |
| --- | --- | --- |
| REQ-111 | vfm shall generate the title slide so that it lists, for each author, the affiliation named in the YAML header, as department, institution and place. | T |
| REQ-112 | vfm shall generate the title slide so that it numbers the affiliations in order of first appearance and marks each author with the numbers of that author's affiliations. | T |
| REQ-113 | vfm shall take the name of an affiliation from `name`, `institution`, `organization` or `department`, in that order. | T |
| REQ-114 | When the header defines top-level `affiliations` and no author refers to any, the title slide shall list all of them once, without numbers. | T |

### Math in captions (UC-36)

| ID | Requirement | Method |
| --- | --- | --- |
| REQ-121 | vfm shall render `$…$` in the caption of a figure, table, listing, algorithm, score and diagram with KaTeX, in document and slide mode. | T |
| REQ-123 | A `$` in a caption that does not close shall remain literal text. | T |

### Subscripts and superscripts (UC-37)

| ID | Requirement | Method |
| --- | --- | --- |
| REQ-131 | vfm shall render `^{text}` in running text as a superscript and `_{text}` as a subscript. | T |
| REQ-132 | vfm shall apply REQ-131 in paragraphs, headings, list items, table cells, captions, slide titles and lead-ins. | T |
| REQ-133 | vfm shall leave `^{…}` and `_{…}` unchanged inside code, math and link destinations. | T |
| REQ-134 | The text between the braces shall be inline Markdown, and a brace pair with no text, or with a line break before the closing brace, shall remain literal text. | T |
| REQ-136 | A backslash before `^` or `_` shall make the pair literal text. | T |

### Video (UC-38)

| ID | Requirement | Method |
| --- | --- | --- |
| REQ-141 | When an image's destination ends in `.mov`, `.mp4`, `.m4v`, `.webm` or `.ogv` (ignoring case, query and fragment), vfm shall render a `<video controls>` element instead of an `<img>`. | T |
| REQ-142 | vfm shall use the image's alt text as the caption of the video figure and shall number it as a figure when it carries a `{#fig:…}` label. | T |
| REQ-143 | vfm shall pass the video to the browser for native playback with `preload="metadata"` and `playsinline`, and shall not set a `type` attribute that would reject a QuickTime container. | I |
| REQ-146 | In slide mode vfm shall place a video as it places an image, and the slide shall scale it to fit its region. | T |

### Table text (UC-18)

| ID | Requirement | Method |
| --- | --- | --- |
| REQ-151 | In document mode vfm shall set the text of a table to 0.9 times the size of the text around it and shall keep the table's caption at the size of the text around it. | T |
| REQ-152 | Text that is not in a table shall keep its size. | T |

### Jump to source from titles and lead-ins (UC-39)

| ID | Requirement | Method |
| --- | --- | --- |
| REQ-161 | vfm shall give the title region of a slide the source line of its origin: the `@slide[title]` line when the title is an override, otherwise the line of the heading. | T |
| REQ-162 | vfm shall give the lead-in region of a slide the line of its `@end(lead-in)`. | T |

### Images fit the slide (UC-20)

| ID | Requirement | Method |
| --- | --- | --- |
| REQ-171 | vfm shall generate each slide so that it scales every image or video down to fit the height and width of its region, preserving its aspect ratio and not enlarging it past its own size. | D |
| REQ-172 | On a `2col` slide that has images and no text, vfm shall give each image its own column, up to two. | T |
| REQ-173 | On a `2col` slide that has text, or only one image, vfm shall lay the slide out in one column in source order, as before. | T |
| REQ-174 | When a `2col` block has more images than fit, vfm shall continue on a new slide. | T |


### Split out of requirements that were shared with the preview

| ID | Requirement | UC | Source |
| --- | --- | --- | --- |
| REQ-041 | vfm shall render a citation key that is not in the bibliography as red text inside the usual brackets, marked as an "unknown citation". | UC-30, UC-34 | README |
| REQ-042 | vfm shall contain no call that fetches from the network while rendering, apart from the one module that posts entries the user added. | UC-33 | vfm README "No network access" |
| REQ-043 | vfm shall give every block element it renders a `data-line` attribute holding the line in the author's file, header and included text included. | UC-31 | README |
| REQ-044 | vfm shall report each directive, include, label and citation problem as a diagnostic with its severity, its file and its line. | UC-34 | README |
| REQ-045 | vfm shall attach each `@note` to the slide that holds the content before it, shall never render it in the document, and shall expose the notes of a slide separately from its body. | UC-32 | README |

## C. New in `slide-colors`

### Separator color (UC-22)

| ID | Requirement | Method |
| --- | --- | --- |
| REQ-201 | When the YAML header holds `separator-color` with a valid color, vfm shall draw the rule below every slide title in that color, whether or not `theme-color` is set. | T |
| REQ-202 | When `separator-color` is absent, vfm shall draw the rule in `theme-color`, as before. | T |

### Section color (UC-23)

| ID | Requirement | Method |
| --- | --- | --- |
| REQ-203 | When the YAML header holds `section-color` with a valid color, vfm shall fill the background of every section slide (divider or agenda) with exactly that color, whether or not `theme-color` is set. | T |
| REQ-204 | When `section-color` is absent and `theme-color` is valid, vfm shall fill the background of section slides with the theme color as REQ-102 says. | T |
| REQ-205 | `section-color` shall not change the background of the title slide or of content slides. | T |
| REQ-206 | On a slide whose background is `section-color` or `theme-color`, vfm shall draw the text in a light color when the background's relative luminance (WCAG 2.x) is below 0.179, the point where white text has more contrast than dark text, and in the default dark text color otherwise. | T |

### Both colors

| ID | Requirement | Method |
| --- | --- | --- |
| REQ-207 | vfm shall accept for `separator-color` and `section-color` the same forms as `theme-color` (REQ-103) and shall pass no other text to the stylesheet. | T |
| REQ-208 | When `separator-color` or `section-color` is present and not valid, vfm shall use the default for that key and shall report a diagnostic whose code is that key and whose line is the key's line in the header. | T |

### Title image (UC-40)

| ID | Requirement | Method |
| --- | --- | --- |
| REQ-211 | When the YAML header holds `title-image` and a title slide exists, vfm shall draw that image over the whole title slide, covering it without distortion, in place of the background color. | T |
| REQ-212 | vfm shall pass the `title-image` URL through `resolveUrl` and shall list it among the deck's `imageUrls`, so a host resolves and preloads it like any slide image. | T |
| REQ-213 | On a title slide with `title-image`, vfm shall draw a translucent dark layer between the image and the text and shall draw the text in white, so the text stays legible on any image. | T |
| REQ-214 | When `title-image` is present and the deck has no title slide (no `title` in the header), vfm shall report a diagnostic with code `title-image` and ignore the key. | T |
| REQ-215 | When `title-image` is absent, vfm shall render the title slide as REQ-107 and the default colors say. | T |

## D. New in `table-fit`

### Tables on slides (UC-25)

| ID | Requirement | Method |
| --- | --- | --- |
| REQ-231 | When a `@slide` block holds a table and a lead-in, vfm shall place every row of the table on the slides and the lead-in on the last one, and shall not drop a table that fits a slide without the lead-in. | T |
| REQ-232 | On a slide vfm shall set the text of a table to 0.9 times the size of the text around it, and when the slide does not fit shall reduce that factor in steps of 0.05 to no less than 0.6 until it fits. | T |
| REQ-233 | When a table does not fit a slide at 0.6, vfm shall continue it on further slides by rows as REQ-012 says, putting on each slide the most rows that fit at 0.6, and shall set each slide's text at the largest factor from REQ-232 at which it fits. | T |
| REQ-235 | On a slide vfm shall size the padding and the line height of table cells in proportion to the table text, so that reducing the factor of REQ-232 reduces the height of a row as well as the size of its text. | T |
| REQ-234 | vfm shall keep the table caption at the size of the text around it, whatever the factor. | T |

### Two tables on a `2col` slide (UC-26)

| ID | Requirement | Method |
| --- | --- | --- |
| REQ-241 | On a `2col` slide vfm shall lay tables out as ordinary blocks in the two columns, balanced at block boundaries and together with any headings and text in the block, so that two tables, each under its own heading, sit side by side; a table alone on a `2col` slide shall take the whole slide. | T |
| REQ-242 | On a slide in any other layout vfm shall keep one table or other float per slide as before. | T |
| REQ-243 | When the tables and text of a `2col` block do not fit side by side, vfm shall reduce the table text as REQ-232 says and, if they still do not fit, shall continue on the next slide, not drop a table. | T |
| REQ-244 | In its browser measurer (`createDomMeasurer`), vfm shall treat a `2col` slide as not fitting when a table in it is wider than its column, so that vfm shrinks the table text or moves the second table to the next slide instead of clipping it. | T |

### Slide typography (UC-27) — deferred

Status: **Deferred**. Not implemented, so its test is marked `todo` and fails by design. Today the document stylesheet
styles slide content (see `README.md`, "Hosting slides"). Decide this before it is built: it changes how every slide looks.

| ID | Requirement | Method | Status |
| --- | --- | --- | --- |
| REQ-245 | When slides are rendered inside the document stylesheet's `.markdownBody`, vfm shall style the headings, paragraphs, lists and code of a slide from `slides/slides.css`, with selectors that out-rank the document's rules for the same elements. | T | Deferred |

## E. New in `conformance`

Tests for these are in `tests/conformance.test.ts`, `tests/features.test.ts` and `tests/tutorial.test.ts`. The cases come from the
published suites of CommonMark, GFM, cmark-gfm and markdown-it (`tests/fixtures/README.md`). 

### Standard Markdown (UC-44)

| ID | Requirement | Method |
| --- | --- | --- |
| REQ-301 | vfm shall render the CommonMark 0.31.2 block constructs (tabs, thematic breaks, ATX and setext headings, indented and fenced code blocks, link reference definitions, paragraphs, block quotes, lists and list items) as that specification gives, apart from the differences in `tests/fixtures/known-divergences.json`. | T |
| REQ-302 | vfm shall render the CommonMark 0.31.2 inline constructs (backslash escapes, character references, code spans, emphasis, links, images, autolinks, hard and soft line breaks) as that specification gives, apart from the differences in `tests/fixtures/known-divergences.json`. | T |
| REQ-303 | vfm shall render GFM tables with a header row, column alignment from the delimiter row, escaped pipes, and rows with fewer or more cells than the header. | T |
| REQ-304 | vfm shall render GFM task list items, `- [ ]` and `- [x]`, as list items that start with a checkbox that is unchecked or checked. | T |
| REQ-305 | vfm shall render `www.` addresses, bare `http://` and `https://` addresses and e-mail addresses as links, and shall leave trailing punctuation outside the link. | T |
| REQ-306 | vfm shall render `[^id]` as a superscript link numbered in order of first use, and its definition `[^id]: text` as a list item in a footnotes section, with a link back to the reference. | T |
| REQ-307 | vfm shall list, in `tests/fixtures/known-divergences.json` with a kind and a reason, every case of the published suites that needs no raw HTML and that it renders differently, and shall render at least 94 % of those cases as the suites expect. | T |

### Features of the flavor (UC-45, UC-46)

| ID | Requirement | Method |
| --- | --- | --- |
| REQ-308 | vfm shall render a block quote whose first line is `[!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]` or `[!CAUTION]`, in any letter case, as a box of the class `alert-<type>` that starts with a title naming the type, and shall render a block quote with another marker, or with text after the marker, as a block quote. | T |
| REQ-309 | vfm shall render `==text==` as highlighted text, and shall leave `====` and a lone `==` as text. | T |
| REQ-314 | vfm shall read the text between `==` marks as inline Markdown. | T |
| REQ-310 | vfm shall render `$…$` as inline math and `$$…$$` as display math with KaTeX, and shall leave a `$` that never closes, and math inside a code span, as text. | T |
| REQ-311 | vfm shall render `:::kind Name {#label}` as a titled environment numbered separately for each of the kinds theorem, lemma, corollary, proposition, conjecture, definition, example, exercise and hypothesis and their short forms, and shall make `[@label]` a link that shows that number. | T |
| REQ-312 | vfm shall number headings to the depth `numberingDepth` gives (none at 0) and shall move every heading down by `headingShift` levels. | T |
| REQ-313 | vfm shall give a fenced code block the class `language-<info>` of the first word of its info string and shall highlight its code; a fence without a language has no language class. | T |
| REQ-315 | vfm shall keep the text of a paragraph that holds text and an image, as a paragraph above or below the figure in source order, and the line break in the image's alt text. | T |
| REQ-316 | vfm shall render a paragraph that directly touches a table as that table's caption, taking its label from the end of the paragraph, and shall render a paragraph separated from the table by a blank line as a paragraph. | T |

### Learning (UC-43)

| ID | Requirement | Method |
| --- | --- | --- |
| REQ-317 | vfm shall ship `docs/tutorial/TUTORIAL.md`, a tutorial in its own flavor that renders as a document and as a deck without error, resolves every cross-reference in it, shows every syntax feature of the README's "Syntax extensions" list, and holds only examples that render on their own. | T |

## F. New in `slides-tutorial`

Tests for these are in `tests/slides-tutorial.test.ts`. The example decks are in `docs/tutorial/slides/` and the tutorial text is `docs/tutorial/SLIDES_TUTORIAL.md`.

### Learning to make slides (UC-47)

| ID | Requirement | Method |
| --- | --- | --- |
| REQ-318 | vfm shall ship the example decks of `docs/tutorial/slides/`, each of which builds as a deck with no diagnostic of severity error, renders every one of its slides, and renders as a document. | T |
| REQ-319 | The example decks shall show, with the structure that `SLIDES_TUTORIAL.md` states for each: a title slide made from the YAML header; a title from the `[title]` override, from the heading and left blank; dividers merged into one agenda slide; a title-only slide; the layouts `rtext`, `ltext` and `2col` with pictures; reveal steps for list items and for the lead-in; paragraph reduction by shape (long paragraph, bold paragraph, ordinals, a colon, a number); a `---` that ends a slide; a cross-reference kept on its own slide and dropped from another, `noxrefs`, `nodoc` and a numbered equation; citations with `showrefs`; presenter notes; a footnote; `theme-color`, `separator-color`, `section-color` and `title-image`; math, a diagram, an algorithm, a score and code; and `@include`. | T |
| REQ-320 | Every example in `SLIDES_TUTORIAL.md` that holds an `@slide` block shall build as a deck without a diagnostic of severity error, every deck in `docs/tutorial/slides/` shall be named in the tutorial, and every deck the tutorial names shall exist. | T |
