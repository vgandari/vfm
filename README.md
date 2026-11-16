# vfm

**vfm** ("flavored markdown") turns a Markdown string into a React element tree. It extends
CommonMark + GFM with the things technical writing needs: numbered and cross-referenced
figures, tables, listings, equations and theorem-style environments, citations with a
generated reference list, algorithm and music blocks, alerts, highlights and a YAML
front-matter header. It runs in the browser, in a Node/server component, and inside a VS Code
webview (see `../src`).

This README describes the package as it is built. Slide support implements
`../slide-directives-spec.md`; see [Slides](#slides).

## Layout

| File | Role |
| --- | --- |
| `pipeline.ts` | The core. `collectRegistry`, `collectCitations`, `renderMarkdown`, `parseMarkdown`. |
| `index.tsx` | `<MarkdownRenderer>`: client component (hooks, async bibliography, registry context). |
| `StaticMarkdownRenderer.tsx` | Async server-component variant with build-time bibliography. |
| `RegistryContext.tsx` | Shares label registries between several renderers on one page. |
| `registry.ts` | `NormalizedRegistry` (label → display text) and `buildRegistry` (numbering pass). |
| `frontmatter.ts` | YAML header parser and typed metadata (`parseFrontmatter`). The header is stripped before rendering; hosts render it themselves. |
| `bibliography*.ts`, `bibtex.ts` | `@cite` entries, BibTeX parsing, APA/MLA/Vancouver formatting, resolvers (fetch / server). |
| `handlers.ts` | mdast→hast handlers (headings, tables, code, math, fenced divs). |
| `AlgorithmPseudocode.tsx`, `MusicAbc.tsx` | React components for algorithm and ABC music blocks. |
| `slides/` | Slide directives: parser, deck builder, splitter, renderer. See [Slides](#slides). |
| `plugins/` | One remark plugin (and sometimes a raw-source preprocessor) per syntax feature. |
| `CustomMarkdown.module.css` | Default stylesheet (`styles.markdownBody`). |
| `test/` | `node --test` suites (`npm test`). |

## How rendering works

Rendering is two passes over the same source so that cross-references resolve regardless of
order.

1. **Prepare the source** (`prepareSource`): strip front matter → inject a component UUID into
   labels/refs (`uuid-inject`, only when `id` is set) → replace algorithm blocks, music blocks
   and fenced divs (`:::thm … :::`) with placeholder fenced code blocks held in side stores.
   Preprocessing is textual because these constructs contain Markdown that must be parsed
   separately.
2. **Registry pass** (`collectRegistry`): parse with `remark-parse` + GFM, expand placeholders
   into custom nodes (`fencedDiv`, `algorithmBlock`, `musicBlock`), then run the labelling
   plugins and `buildRegistry`, which numbers headings and labelled items
   (`Figure 2.1`, `Theorem 1.3`, …) and records `label → displayText`.
3. **Render pass** (`renderMarkdown`): the same tree again, then `cross-refs`
   (`[@fig:x]` → link), optional `suppress-labels`, optional `citations`, `remark-rehype` with
   custom handlers, `rehype-raw`, `rehype-highlight`, and `rehype-react`.

Plugin order in the shared remark pipeline: fenced divs → algorithm → music → alerts →
highlight (`==x==`) → math → equation labels → (prepend title) → heading shift → labels →
registry.

## Syntax extensions

- **Labels** `{#fig:name}`, `{#tab:…}`, `{#lst:…}`, `{#eq:…}`, `{#sec:…}`, `{#alg:…}`, `{#mus:…}`
  on headings, images, tables (caption paragraph above), code fences (info string) and display math.
- **Cross-references** `[@fig:name]`, resolved against the registry; unresolved refs are
  left as-is (client) or shown red (static render).
- **Fenced divs** `:::theorem Name {#thm:x}` … `:::` (aliases `thm`, `lem`, `cor`, `prp`, `cnj`,
  `def`, `exm`, `exr`, `hyp`). Not nestable.
- **Citations** `@cite(key)` / `@cite(a, b)`; entries come from a `BibResolver`. Styles are set
  by `CitationConfig`.
- **Alerts** `> [!NOTE]` and friends; **highlight** `==text==`; **underline** `~text~` (a single tilde, rendered
  `<u>`; `~~text~~` stays strikethrough, and `about ~5 to ~10` is left alone because a pair needs text touching
  both tildes); **math** via `remark-math` + KaTeX.
- **Algorithm**, **music (ABC)** and **Mermaid** blocks are fenced code with a reserved language,
  rendered by React components:

  ````text
  ```alg Caption text {#alg:name}         (pseudocode.js body)
  ```mus Caption text {#mus:name}         (ABC notation body)
  ```mermaid Caption text {#fig:name}     (Mermaid diagram; numbered as a Figure)
  ````

  A score has a Play button: `music-audio.ts` reads the MIDI that abcjs writes for the tune and sounds it with
  Web Audio oscillators (abcjs's own synth would download soundfonts). The caption and label are optional. A block closes at a fence of the same character and at least the
  same length. Nothing here reaches the network: see "No network access" below.
- **No raw HTML.** Anything the parser reads as HTML (`<sup>a</sup>`, `<br>`, `<div>`) is shown as text, in document
  and slide mode alike (`plugins/no-html.ts`). HTML comments `<!-- … -->` are kept: they are invisible and vfm's slide
  directives travel as comments. For superscripts and subscripts use `^{2}` and `_{2}` (below) or math (`$x^2$`).
- **Subscripts and superscripts** outside math: `H_{2}O`, `x^{2}`, `10^{-3}`. The braces hold inline Markdown and may
  nest (`a^{b_{c}}`); a pair needs text and must close on its line, otherwise it stays literal; `\^{x}` is literal; code and math
  are untouched (`plugins/sub-sup.ts`). Braces rather than `~x~` / `^x^` because a single tilde is underline and `[^1]` is a footnote.
- **Captions hold inline Markdown**: `$math$`, `H_{2}O`, emphasis, code. This holds for figures, tables, listings,
  algorithms, scores and diagrams (`plugins/caption-nodes.ts`). Plain text stays plain; a `$` that never closes is a dollar sign.
- **Video** uses the image syntax: `![Caption](clip.mov)`. `.mov`, `.mp4`, `.m4v`, `.webm` and `.ogv` (any case, query and
  fragment ignored) become `<video controls preload="metadata" playsinline>` inside the same figure as an image, with the same
  numbering, and on slides they are placed and scaled like images. The browser plays the file itself, with no `type` attribute
  (Chromium may reject `video/quicktime` for a `.mov` it can play), so the codec must be playable there (H.264/AAC is).
- **Theme color**: `theme-color: "#1a6ea8"` in the YAML header (`#rgb`, `#rrggbb`, `rgb()`, `hsl()` or a CSS color name; see
  `slides/themeColor.ts`). Slides draw the rule under each title in it, and the title and section slides use a 14 % tint of it,
  in white, as background with dark text. An invalid value is reported (`theme-color`) and ignored.
- **Independent colors**: `separator-color` sets the rule under slide titles (default: `theme-color`); `section-color` sets the
  background of section slides exactly as written (default: the tint of `theme-color`), with light text when the color is dark (relative luminance below 0.179, where white has more contrast than the dark text) and dark text otherwise;
  `title-image: cover.jpg` replaces the title slide's background with that image under a dark scrim and white text. Invalid
  colors are reported (`separator-color`, `section-color`) and ignored; `title-image` without a `title` is reported and ignored.
- **Table text** is 0.9 times the surrounding size, in documents and on slides.
- **Front matter**: YAML with title, authors, affiliations, abstract, etc.

## Options

`ParseOptions` (see `pipeline.ts`): `numberingDepth` (0 disables heading numbers),
`headingShift`, `id` (UUID namespace for multiple documents per page), `title`/`titleLevel`,
`suppressUnreferencedLabels`, `bibliography`, `bibliographyPending`, `citations`.

## Slides

One file renders as a document by default and as a slideshow when the author wraps content in
`@slide … @end`. The parser stores content only; slides are a second view over the same AST.

```text
@slide[Title override](rtext, showrefs, nodoc, noxrefs, steplists, stepleadin)
  …whole blocks, headings allowed…
@end(Lead-in shown on the last slide of the block)
```

Layouts: `rtext`, `ltext`, `2col`. `@include(path)` (own line) splices another file in before
anything else is parsed. The full rules are in the spec; this section covers how they map to code.

### Modes

- **Document** (`renderMarkdown`): the `@slide` markers vanish, wrappers are transparent, `nodoc`
  blocks are removed. Titles and lead-ins are never shown. Directive syntax errors, unknown labels
  and references into `nodoc` content throw `SlideDirectiveError` (label checks apply only to
  documents that contain `@slide`, so older documents behave as before).
- **Slide** (`buildSlideDeck` → `renderSlide`): prune to `@slide` content, merge dividers, filter
  cross-reference units, split, number deck-wide, assign reveal steps.

### Code map (`slides/`)

| File | Stage |
| --- | --- |
| `includes.ts` | `@include` expansion with cycle detection and a line map back to the original files. |
| `directives.ts` | Preprocessor swaps each directive line for a one-line `<!--vfm:slide:N-->` comment (line numbers never move); a remark plugin turns the markers into `SlideBlock`s. Sits after `remarkLabels` and before the registry in `pipeline.ts`. |
| `validate.ts` | Stage 1 label checks (`unknown-label`, `doc-ref-into-nodoc`). |
| `segment.ts` | Sentence segmenter and text-only inline content for repeated context. |
| `units.ts` | Units (sentence, list item, heading + first unit, whole block) and `materialize`, which rebuilds paragraphs, nested lists and context from placed units. |
| `split.ts` | The greedy splitter with the co-location rule. |
| `deck.ts` | Orchestration: titles, dividers/agendas, early drops, splitting, numbering, citations, steps, `checkSlides`. |
| `render.ts` | `renderSlide(slide, deck.render)`: fixed DOM structure styled by `slides.css`. |
| `measure.ts` | `Measurer` type and `estimateFits`, a DOM-free heuristic. |
| `slides.css` | 1280×720 stage, layouts, step visibility. |

### Using it

```ts
import { buildSlideDeck, renderSlide, SlideDirectiveError } from "vfm/slides";
import "vfm/slides/slides.css";

const deck = buildSlideDeck(markdown, {
  measure,      // (slide, render) => boolean; renders offscreen and tests overflow. Default: estimateFits
  resolveUrl,   // rewrite image URLs (preload images before measuring)
  sourceMap,    // from expandIncludes, so diagnostics name the original file
  bibliography, citations,
});
deck.slides.map((s) => renderSlide(s, deck.render));
deck.diagnostics;   // everything `check` reports, with codes and locations
```

`Slide.steps` / `data-step` attributes drive reveal stepping: show elements whose
`data-step` ≤ the current step; hidden items keep their space.

### Paragraphs, sentences and separators

- **Sentences are one per line.** A sentence ends at sentence-ending punctuation (`. ! ? … 。 ！ ？`, plus
  any closing quote or bracket) followed by a line break. Nothing else is a boundary, so there is no
  abbreviation list and no language-specific rule: `Dr. Chen` on one line is never cut. A paragraph
  written on one line is one sentence.
- **Paragraphs are reduced** (`slides/reducer.ts`, designed in `../paragraph-reducer/`). Inside a `@slide`
  block a paragraph becomes slide text by selecting and deleting only, never rewriting: a paragraph
  that is only bold is kept verbatim; sentences starting with ordinals (or `1.`) become a numbered list;
  `intro: a, b, and c` becomes bullets; a one-sentence paragraph around a `%` or currency value
  becomes a callout (`.vfm-callout`); anything else keeps its top two sentences (bold, first, last,
  words shared with the title or heading, numbers, minus a penalty for throwaway openers; IDF is taken
  over the whole file), after dropping bracketed text, dash asides, and one comma-delimited aside when it opens with a word from the language's aside list (English: which, including, …). Paragraphs of six
  sentences or more are first split where the topic changes. A sentence that opens with a background clause
  (`While A, B.` `Despite A, B.`; the opener list is per language) is reduced to its main clause B, cutting at
  the first comma, unless that would remove bold text, leave under four words, or the first comma looks like part of a list. Bullets from consecutive paragraphs form
  one list. Sentences that are not picked do not appear on the slide.
- **Settings** (YAML header): `paragraphs: auto | first-sentence | notes-only | full` (`full` keeps whole
  paragraphs as before; `SlideDeckOptions.paragraphs` overrides it) and `lang:` (default English).
  Language-specific data (lead-in words, ordinals, list phrases, anaphoric openers) lives in
  `slides/languages/`, one file per language, apart from the language-independent code; a language
  without a file gets the language-independent behavior only. Not implemented from the design:
  grammar-based trimming (needs a dependency parser) and the contrast layout. The anaphora guard
  uses the profile's word list only, since a statistical one fires on articles like "The".
- **Titles and counters.** When a block with several sections spans several slides, each slide is titled by the
  heading it starts with, and every slide sharing a title shows its counter, `(1/2)`, `(2/2)`.
- **What does not fit.** Content is placed in whole units, and type size never changes to make room: a list or
  paragraph that is too tall simply continues on the next slide, and a table is never scaled. Only a lone
  picture, listing, theorem environment, algorithm, score or diagram is scaled, down to half size at most. A float still too tall after that is dealt with by kind:
  a **table with a header row** that is too tall is split by rows across slides with the header repeated on each (hint `table-split`; the fit check looks at whether the rows fit the slide's height);
  an image, algorithm, score, diagram, theorem environment, code listing, or a table with no header row (an
  empty first row) is **left off the slide** with a hint (`drop-float`). Only something that cannot be
  divided at all, such as one sentence taller than a slide, is an `overflow` error. A long paragraph that
  continues on the next slide is a hint (`paragraph-split`), not a warning.
- **A document separator** (`---`, `***`) inside a `@slide` block ends the slide: what follows starts a
  new one, without a repeated heading. The separator itself is never shown.

### Rules beyond the spec

These fill gaps the spec leaves open; the spec itself is unchanged.

- **Floats.** Theorem environments, admonitions, quotes, code listings, tables, algorithms and
  scores are placed like images: the slide holds at most one, `rtext` / `ltext` put it in the image
  region, `2col` falls back to one column for that slide, and an extra one spills onto its own slide.
  The exception is a `2col` slide that holds images and no text: with two images, each has its own column (a third
  starts a new slide). Pictures and videos always shrink to fit their region, keeping their aspect ratio.
  When no text shares the slide, `rtext` / `ltext` revert to a single column. Floats are never
  dropped by the cross-reference filter. A reference inside one that cannot resolve renders as plain
  text, with a `check` warning.
- **Numbering.** Only items that a surviving reference points to (on the same slide) are numbered,
  and they are numbered 1, 2, 3 deck-wide with no gaps. Everything else shows just its caption,
  with no "Figure 1.1". (`buildRegistry`'s `visibleLabels` option.)
- **Footnotes.** Only footnotes defined inside the slide's own `@slide` block are shown. Each slide
  shows the ones its text cites, numbered from 1 on that slide, at the end of the region that cites
  them, so the fit test reserves their room. The definitions are not slide content. One written
  outside the block (or after `@end`) still works in document mode but gives an `unknown-footnote`
  warning in slide mode. A footnote reference in a `[title]` or an `@end(lead-in)` is a `syntax`
  error, like `@cite`.
- **Link reference definitions** (`[text][ref]` with `[ref]: https://…` written elsewhere) are
  looked up document-wide, since they show nothing themselves.
- **Title-only blocks.** `@slide[Title]` with nothing inside is always its own slide, one large title.
  It never joins an agenda, and it breaks a run of dividers.
- **Title slide.** A YAML header with a `title` makes slide 1 from `title`, `subtitle`, `authors`
  (with numbered affiliations) and `date`. An affiliation is read from `name`, `institution`, `organization` or `department`; a
  top-level `affiliations:` list that no author refers to is listed as it is, without numbers.
- **Source lines.** The title region of a slide carries `data-line` (the `@slide[title]` line, or the heading the title came
  from) and the lead-in carries the line of its `@end(...)`, so a host can jump to them. `Slide.titleLine` / `leadinLine`.
- **Slide number** in the lower right of every slide except the title slide; the title slide counts
  as slide 1. The viewer passes it to `renderSlide(slide, ctx, { number })`.

- **Presenter notes.** `@note(text)` inside a `@slide` block, on its own line, inline Markdown, balanced
  parentheses (`\)` for a literal one), and it may run over several lines. A note belongs to the slide that
  holds the content right before it, so when a block splits, each rendered slide gets the notes written
  after its content and before the next slide's. A note before any content goes to the block's first slide;
  notes on a divider run are combined on that slide. Notes never appear in the document, in slide
  rendering or in the PDF; `renderNotes(slide, deck.render)` renders them for a presenter UI. Outside a
  block `@note(...)` is ordinary text, left as written. Inside one, a note without parentheses or with
  unbalanced ones is a `syntax` error.

### Known limits

- **Renderer-side shrink.** The splitter only asks "does it fit?". The VS Code webview answers by scaling a
  lone float (score, algorithm, listing, image, table) that is too tall for its region down to half size,
  so it is shown instead of reported as an overflow. A region with several blocks is never scaled; the
  splitter moves content to the next slide.

- **Bundling `pseudocode`.** pseudocode 2.4.1 relies on sloppy-mode implicit globals (`attrVal`, `ifCond`,
  `katex = require(...)`). A bundle with `"use strict"` makes every algorithm block throw or report "No math
  backend found". The extension's `esbuild.mjs` turns the directive off (`alwaysStrict: false`); a host that
  bundles vfm needs the same.

- Locations are exact for directives, content nodes and lines in included files: the raw-source
  preprocessors (fenced divs, algorithm, music, mermaid) replace each block with a placeholder of the same
  number of lines.
- Retroactive drops can leave `showrefs` accounting for an earlier closed slide slightly off.
- `@more`, `nomerge` and the comment-wrapped form are listed as open items in the spec and are not implemented.

## No network access

The one catch was `pseudocode/build/pseudocode.min.css`, which begins with `@import url(https://cdnjs…/katex.min.css)`:
import `markdown/pseudocode.css` (the same stylesheet without that line) and `katex/dist/katex.min.css` instead.
Nothing in the render path fetches anything: KaTeX, abcjs (`renderAbc` only, no synth, so no
soundfonts), pseudocode.js and Mermaid (`securityLevel: "strict"`, no icon packs, no web fonts) run
entirely in the page, with fonts and styles bundled. `test/no-network.test.ts` fails if a source file
here calls `fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon` or loads a script, stylesheet or font
from a URL. Hosts should still set a Content-Security-Policy without `connect-src`; the VS Code
preview and its exports do. `bibliography-client.ts` is the one exception: it POSTs entries the user
chose to add to their own server and is not part of rendering.

## Tests

`npm test` runs `test/*.test.ts` with Node's built-in runner (type stripping, no build step).
`test/slides.test.ts` bundles the pipeline with esbuild first, because it imports `.tsx` components.

## Use cases and requirements

`vfm` is the core that `vfm-preview` builds on, so the use cases and requirements for rendering live here:
[docs/USE_CASES.md](docs/USE_CASES.md) and [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md). `MAPPING.json` links use cases,
requirements and test cases, and `python3 tools/check_mapping.py` checks that each use case and requirement has a test.
Requirements about the editor extension are in `vfm-preview`; IDs are shared, and each requirement lives in one repository.
