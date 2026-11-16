# Use cases

The use cases `vfm` serves. The *author* writes Markdown and the *audience* reads the document or sees the slides.
Several use cases are shared with `vfm-preview` (`../vfm-preview/docs/USE_CASES.md`), which adds the ones that need an
editor, a window or an export file. A shared use case has the same ID and text in both, and each repository
maps it only to its own requirements.

## Existing behavior (inferred)

| ID | Use case | Source |
| --- | --- | --- |
| UC-01 | The author previews a Markdown file as a document, beside the editor, and the preview follows edits. | README "VFM Preview" |
| UC-02 | The author previews the same file as slides, moves between slides and reveal steps with the keyboard, and toggles between the two views. | README "Slide mode" |
| UC-03 | The author turns existing content into slides by wrapping it in `@slide … @end`, choosing a layout (`rtext`, `ltext`, `2col`), and splicing files with `@include`. | spec "Syntax" |
| UC-04 | The author cites sources with `@cite(key)` and gets in-text citations and a reference list from BibTeX files named in the YAML header. | README "Citations" |
| UC-05 | The author numbers figures, tables, listings and equations and refers to them by label. | vfm README "Syntax extensions" |
| UC-06 | The author includes pseudocode, music scores and Mermaid diagrams as fenced blocks. | README "Diagrams, algorithms, scores" |
| UC-07 | The author edits from the preview: toggles task checkboxes, double-clicks to jump to the source, scrolls the editor and preview together. | README "Editing from the preview" |
| UC-09 | The presenter keeps private notes with `@note(…)` and shows them in a presenter view. | README "Presenter notes" |
| UC-10 | The author works offline and the preview never contacts the network. | vfm README "No network access" |
| UC-11 | The author learns about directive and citation problems in the Problems panel. | README "Slide mode", "Citations" |
| UC-12 | The author writes whole paragraphs and the slide builder reduces them to slide text without rewriting. | vfm README "Paragraphs, sentences and separators" |

## New in `slide-polish`

| ID | Use case | Origin |
| --- | --- | --- |
| UC-13 | The author gives a deck a theme color. The rule under every slide title uses it, and the title slide and section slides sit on a lighter tint of it. | request |
| UC-14 | The audience sees each author's affiliation on the title slide. | request |
| UC-15 | The author writes math in the caption of a figure, table, listing, algorithm, score or diagram. | request |
| UC-16 | The author writes subscripts and superscripts in ordinary text (chemical formulas, units, ordinals, footnote-like marks) without switching to math. | request |
| UC-17 | The author adds a video, especially a `.mov` file, with the same syntax as an image and plays it in the preview. | request |
| UC-18 | The reader finds table text slightly smaller than the surrounding text, so wide tables fit. | request |
| UC-19 | The author double-clicks a slide title or a lead-in in the slide preview and lands on the line of the file that produced it. | bug report |
| UC-20 | The author adds images of any size and they are shown whole on the slide; two images on a `2col` slide each get a column. | bug report |
