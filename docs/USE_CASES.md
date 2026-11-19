# Use cases

The use cases `vfm` serves. The *author* writes Markdown and the *audience* reads the document or sees the slides.
`vfm-preview` (`../vfm-preview/docs/USE_CASES.md`) adds the ones that need an editor, a window or an export file.
UC-01 and UC-02 (preview in an editor, slide navigation) belong to `vfm-preview` only. Use case IDs are unique across
the two repositories, and each repository maps its own to its own requirements.

## Existing behavior (inferred)

| ID | Use case | Source |
| --- | --- | --- |
| UC-03 | The author turns existing content into slides by wrapping it in `@slide … @end`, choosing a layout (`rtext`, `ltext`, `2col`), and splicing files with `@include`. | spec "Syntax" |
| UC-30 | The author cites sources with `@cite(key)` and gets in-text citations and a reference list from BibTeX files named in the YAML header. | README "Citations" |
| UC-05 | The author numbers figures, tables, listings and equations and refers to them by label. | vfm README "Syntax extensions" |
| UC-06 | The author includes pseudocode, music scores and Mermaid diagrams as fenced blocks. | README "Diagrams, algorithms, scores" |
| UC-31 | The author edits from the preview: toggles task checkboxes, double-clicks to jump to the source, scrolls the editor and preview together. | README "Editing from the preview" |
| UC-32 | The presenter keeps private notes with `@note(…)` and shows them in a presenter view. | README "Presenter notes" |
| UC-33 | The author works offline and the preview never contacts the network. | vfm README "No network access" |
| UC-34 | The author learns about directive and citation problems in the Problems panel. | README "Slide mode", "Citations" |
| UC-12 | The author writes whole paragraphs and the slide builder reduces them to slide text without rewriting. | vfm README "Paragraphs, sentences and separators" |
| UC-28 | The author gets a deck with a title slide from the YAML header, a number on every slide, and list items or lead-ins revealed one step at a time. | split from UC-02 |
| UC-29 | The author underlines text with `~text~` and strikes it through with `~~text~~`. | split from UC-01 |

## New in `slide-polish`

| ID | Use case | Origin |
| --- | --- | --- |
| UC-35 | The author gives a deck a theme color. The rule under every slide title uses it, the title slide and the section slides sit on that color as it is. | request |
| UC-14 | The audience sees each author's affiliation on the title slide. | request |
| UC-36 | The author writes math in the caption of a figure, table, listing, algorithm, score or diagram. | request |
| UC-37 | The author writes subscripts and superscripts in ordinary text (chemical formulas, units, ordinals, footnote-like marks) without switching to math. | request |
| UC-38 | The author adds a video, especially a `.mov` file, with the same syntax as an image and plays it in the preview. | request |
| UC-18 | The reader finds table text slightly smaller than the surrounding text, so wide tables fit. | request |
| UC-39 | The author double-clicks a slide title or a lead-in in the slide preview and lands on the line of the file that produced it. | bug report |
| UC-20 | The author adds images of any size and they are shown whole on the slide; two images on a `2col` slide each get a column. | bug report |

## New in `slide-colors`

| ID | Use case | Origin |
| --- | --- | --- |
| UC-22 | The author sets the color of the rule under slide titles on its own, without it being tied to the theme color. | request |
| UC-23 | The author sets the background color of section slides on its own, without it being tied to the theme color. | request |
| UC-40 | The author replaces the background of the title slide with an image. | request |

## New in `table-fit`

| ID | Use case | Origin |
| --- | --- | --- |
| UC-25 | The author puts a table on a slide, with or without a lead-in under it, and sees the whole table with its text as large as the slide allows. | bug report, request |
| UC-26 | The author puts two tables side by side on one `2col` slide. | request |
| UC-27 | The author sets the typography of slide headings, paragraphs, lists and code independently of the document's. | deferred; request |

## New in `conformance`

| ID | Use case | Origin |
| --- | --- | --- |
| UC-43 | A person who is learning Markdown follows one tutorial that is itself written in the flavor, sees what each example gives, and learns the flavor's own features. | request |
| UC-44 | The author writes standard Markdown (CommonMark and GitHub's extensions) and gets what other tools give, so a file moves between tools without surprises. | request |
| UC-45 | The author writes alerts, highlights, math, code with a language, theorems and footnotes, and gets the box, the mark, the equation, the colored code, the numbered environment and the note. | request |
| UC-46 | The author numbers headings to a chosen depth and shifts them to fit a larger document. | request |

## New in `slides-tutorial`

| ID | Use case | Origin |
| --- | --- | --- |
| UC-47 | A person who has a document or an outline learns to turn it into slides by following examples: they open a complete deck, change it and see the result, and learn what VFM reports when something does not fit. | request |

## New in `preview-bugs`

| ID | Use case | Origin |
| --- | --- | --- |
| UC-48 | The author ticks and unticks task checkboxes in the preview, and the preview always shows what the file says. | bug report |
| UC-49 | The author double-clicks the title slide or a picture in the preview, and lands on the line of the file that wrote it. | bug report |
| UC-50 | A reader follows a cross-reference to a figure or a listing and sees it with its caption, however large it is. | bug report |
| UC-51 | The author cites sources in captions and lead-ins as in text, and the deck ends with a References slide that lists them. | bug report |
| UC-52 | The author puts two groups of bullets on a `2col` slide and separates them with a blank line, as in any Markdown file. | bug report |
| UC-55 | The author's math, tables, videos and captions are shown whole and in the same style on every slide. | bug report |
