# Requirements

`vfm` is the core library: it parses Markdown, builds documents and slides, and renders them. The editor extension
`vfm-preview` (`../vfm-preview`) is a client of it and keeps its own requirements. The ID space is shared, so an ID
means the same thing in both repositories, and a requirement lives in exactly one of them.

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
| REQ-007 | vfm shall replace an `@include(path)` line with the contents of the named file before parsing and shall report a cycle as a diagnostic. | UC-03 | vfm README `includes.ts` |
| REQ-008 | vfm shall end the current slide at a document separator (`---`, `***`) inside a `@slide` block and shall not display the separator. | UC-03 | vfm README |
| REQ-009 | vfm shall make slide 1 from the YAML header's `title`, `subtitle`, authors, affiliations and `date` when a `title` exists. | UC-02 | vfm README "Title slide" |
| REQ-010 | vfm shall number slides from 1, counting the title slide, and shall show the number in the lower right corner of every slide except the title slide. | UC-02 | vfm README, `update.md` |
| REQ-011 | vfm shall place content in whole units and shall not change type size to make room, except that it shall scale a lone float down to at most half size. | UC-03 | vfm README "What does not fit" |
| REQ-012 | vfm shall split a table that has a header row and is too tall across slides by rows, repeating the header. | UC-03 | vfm README |
| REQ-013 | vfm shall reveal list items one per step under `steplists` and the lead-in on the last step under `stepleadin`. | UC-02 | spec "Reveal steps" |
| REQ-014 | vfm shall reduce a paragraph inside a `@slide` block to slide text by selecting and deleting sentences only, never by rewriting, unless the mode is `paragraphs: full`. | UC-12 | vfm README |
| REQ-015 | vfm shall treat sentence-ending punctuation followed by a line break as the only sentence boundary. | UC-12 | `update.md` |

### Citations, labels, blocks

| ID | Requirement | UC | Source |
| --- | --- | --- | --- |
| REQ-016 | vfm shall resolve `@cite(key)` and `@cite(a, b)` against the BibTeX files named in the YAML header `bibliography` key. | UC-04 | README "Citations" |
| REQ-019 | vfm shall number labelled headings, figures, tables, listings, equations, algorithms and scores and shall replace `[@label]` with a link showing the number. | UC-05 | vfm README |
| REQ-020 | In slide mode vfm shall number only items that a surviving cross-reference points to, consecutively across the deck. | UC-05 | vfm README "Numbering" |
| REQ-021 | vfm shall render fenced blocks with the language `alg`, `mus` or `mermaid` as an algorithm, a score with a Play button, or a diagram numbered as a figure. | UC-06 | vfm README |
| REQ-022 | vfm shall display raw HTML as text and shall keep HTML comments invisible. | UC-03 | vfm README "No raw HTML" |

### Bibliography, footnotes, syntax, music (found while mapping the existing tests)

| ID | Requirement | UC | Source |
| --- | --- | --- | --- |
| REQ-034 | vfm shall parse BibTeX entries of any type and field, resolve `crossref` and biblatex aliases without overwriting fields, keep each entry's source text, and report a repeated key, an unreadable entry or a bad crossref. | UC-04 | `bibtex.ts` |
| REQ-035 | vfm shall format a reference in APA, MLA or Vancouver style for each entry type, and shall not fail or leave stray punctuation when fields are missing. | UC-04 | `bibliography.ts` |
| REQ-036 | vfm shall resolve each cited key once, treating keys as case-sensitive, and shall validate each entry it receives. | UC-04 | `bibliography.ts` |
| REQ-037 | vfm shall validate an entry before sending it to the user's own server, send nothing for an invalid one, and describe a refusal or an unreachable server in words the author can act on. | UC-04 | `bibliography-client.ts` |
| REQ-038 | vfm shall play a score by reading the notes abcjs writes for the tune, following repeats, without loading anything from the network. | UC-06 | `music-audio.ts` |
| REQ-039 | In slide mode vfm shall show a footnote only on a slide whose text cites it, only when it is defined inside that slide's `@slide` block, numbered from 1 on that slide. | UC-03 | vfm README "Footnotes" |
| REQ-040 | vfm shall render `~text~` as underline and `~~text~~` as strikethrough, and shall leave a lone tilde as text. | UC-01 | vfm README |

## B. New in `slide-polish`

### Theme color (UC-13)

| ID | Requirement | Method |
| --- | --- | --- |
| REQ-101 | When the YAML header holds `theme-color` with a valid CSS color, vfm shall draw the rule below every slide title in that color. | T |
| REQ-102 | When `theme-color` is valid, vfm shall fill the background of every section slide (divider, unless `section-color` is set) with the theme color mixed 14 % into white, and shall draw text on those slides in the default dark text color. | T |
| REQ-103 | vfm shall accept `#rgb`, `#rrggbb`, `rgb()`, `hsl()` and CSS color names as `theme-color`, and shall pass no other text to the stylesheet. | T |
| REQ-104 | When `theme-color` is present and not valid, vfm shall use the default colors and shall report a diagnostic with code `theme-color` and the line of the header. | T |
| REQ-105 | When `theme-color` is absent, vfm shall render slides with the default colors, identical to the previous release. | T |
| REQ-107 | When `theme-color` is valid and `title-image` is absent, vfm shall fill the background of the title slide with exactly the theme color, with no tint, and shall draw its text in light color when the theme color's relative luminance is below 0.179 (REQ-206) and in the default dark text color otherwise. | T |

### Affiliations on the title slide (UC-14)

| ID | Requirement | Method |
| --- | --- | --- |
| REQ-111 | The title slide shall list, for each author, the affiliation named in the YAML header, as department, institution and place. | T |
| REQ-112 | The title slide shall number the affiliations in order of first appearance and mark each author with the numbers of that author's affiliations. | T |
| REQ-113 | vfm shall take the name of an affiliation from `name`, `institution`, `organization` or `department`, in that order. | T |
| REQ-114 | When the header defines top-level `affiliations` and no author refers to any, the title slide shall list all of them once, without numbers. | T |

### Math in captions (UC-15)

| ID | Requirement | Method |
| --- | --- | --- |
| REQ-121 | vfm shall render `$…$` in the caption of a figure, table, listing, algorithm, score and diagram with KaTeX, in document and slide mode. | T |
| REQ-123 | A `$` in a caption that does not close shall remain literal text. | T |

### Subscripts and superscripts (UC-16)

| ID | Requirement | Method |
| --- | --- | --- |
| REQ-131 | vfm shall render `^{text}` in running text as a superscript and `_{text}` as a subscript. | T |
| REQ-132 | vfm shall apply REQ-131 in paragraphs, headings, list items, table cells, captions, slide titles and lead-ins. | T |
| REQ-133 | vfm shall leave `^{…}` and `_{…}` unchanged inside code, math and link destinations. | T |
| REQ-134 | The text between the braces shall be inline Markdown, and a brace pair with no text, or with a line break before the closing brace, shall remain literal text. | T |
| REQ-136 | A backslash before `^` or `_` shall make the pair literal text. | T |

### Video (UC-17)

| ID | Requirement | Method |
| --- | --- | --- |
| REQ-141 | When an image's destination ends in `.mov`, `.mp4`, `.m4v`, `.webm` or `.ogv` (ignoring case, query and fragment), vfm shall render a `<video controls>` element instead of an `<img>`. | T |
| REQ-142 | vfm shall use the image's alt text as the caption of the video figure and shall number it as a figure when it carries a `{#fig:…}` label. | T |
| REQ-143 | vfm shall pass the video to the browser for native playback with `preload="metadata"` and `playsinline`, and shall not set a `type` attribute that would reject a QuickTime container. | I |
| REQ-146 | In slide mode vfm shall place a video as it places an image, and the slide shall scale it to fit its region. | T |

### Table text (UC-18)

| ID | Requirement | Method |
| --- | --- | --- |
| REQ-151 | vfm shall set the text of a table to 0.8 times the size of the text around it, in document mode and in slide mode, and shall keep the table's caption at the size of the text around it. | T |
| REQ-152 | Text that is not in a table shall keep its size. | T |

### Jump to source from titles and lead-ins (UC-19)

| ID | Requirement | Method |
| --- | --- | --- |
| REQ-161 | vfm shall give the title region of a slide the source line of its origin: the `@slide[title]` line when the title is an override, otherwise the line of the heading. | T |
| REQ-162 | vfm shall give the lead-in region of a slide the line of its `@end(lead-in)`. | T |

### Images fit the slide (UC-20)

| ID | Requirement | Method |
| --- | --- | --- |
| REQ-171 | The slide shall scale every image or video down to fit the height and width of its region, preserving its aspect ratio and not enlarging it past its own size. | D |
| REQ-172 | On a `2col` slide that has images and no text, vfm shall give each image its own column, up to two. | T |
| REQ-173 | On a `2col` slide that has text, or only one image, vfm shall lay the slide out in one column in source order, as before. | T |
| REQ-174 | When a `2col` block has more images than fit, vfm shall continue on a new slide. | T |


### Split out of requirements that were shared with the preview

| ID | Requirement | UC | Source |
| --- | --- | --- | --- |
| REQ-041 | vfm shall render a citation key that is not in the bibliography as red text inside the usual brackets, marked as an "unknown citation". | UC-04, UC-11 | README |
| REQ-042 | vfm shall contain no call that fetches from the network while rendering, apart from the one module that posts entries the user added. | UC-10 | vfm README "No network access" |
| REQ-043 | vfm shall give every block element it renders a `data-line` attribute holding the line in the author's file, header and included text included. | UC-07 | README |
| REQ-044 | vfm shall report each directive, include, label and citation problem as a diagnostic with its severity, its file and its line. | UC-11 | README |
| REQ-045 | vfm shall attach each `@note` to the slide that holds the content before it, shall never render it in the document, and shall expose the notes of a slide separately from its body. | UC-09 | README |

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
| REQ-204 | When `section-color` is absent, vfm shall fill the background of section slides as REQ-102 says. | T |
| REQ-205 | `section-color` shall not change the background of the title slide or of content slides. | T |
| REQ-206 | On a section slide with `section-color`, vfm shall draw the text in white-ish when the background's relative luminance (WCAG 2.x) is below 0.179, the point where white text has more contrast than dark text, and in the default dark text color otherwise. | T |

### Both colors

| ID | Requirement | Method |
| --- | --- | --- |
| REQ-207 | vfm shall accept for `separator-color` and `section-color` the same forms as `theme-color` (REQ-103) and shall pass no other text to the stylesheet. | T |
| REQ-208 | When `separator-color` or `section-color` is present and not valid, vfm shall use the default for that key and shall report a diagnostic whose code is that key and whose line is the key's line in the header. | T |

### Title image (UC-24)

| ID | Requirement | Method |
| --- | --- | --- |
| REQ-211 | When the YAML header holds `title-image` and a title slide exists, vfm shall draw that image over the whole title slide, covering it without distortion, in place of the background color. | T |
| REQ-212 | vfm shall pass the `title-image` URL through `resolveUrl` and shall list it among the deck's `imageUrls`, so a host resolves and preloads it like any slide image. | T |
| REQ-213 | On a title slide with `title-image`, vfm shall draw a translucent dark layer between the image and the text and shall draw the text in white, so the text stays legible on any image. | T |
| REQ-214 | When `title-image` is present and the deck has no title slide (no `title` in the header), vfm shall report a diagnostic with code `title-image` and ignore the key. | T |
| REQ-215 | When `title-image` is absent, vfm shall render the title slide as REQ-107 and the default colors say. | T |
