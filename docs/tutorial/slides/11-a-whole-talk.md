---
title: Reducing Paragraphs to Slides
subtitle: A complete talk in one Markdown file
authors:
  - name: Ada Lovelace
    affiliation: a1
affiliations:
  - {id: a1, name: Analytical Engine Lab}
date: 2026-11-16
theme-color: "#1a6ea8"
bibliography: ../tutorial.bib
---

# Motivation

@slide[Why this talk](steplists, stepleadin)
- Slides need terse text
- Papers are written in prose
- Rewriting by hand is slow
@note(Open with the claim: nothing is invented.)
@end(Pick, never rewrite.)

# Method

@slide[Outline]
## Sentences
## Scoring
## Results
@end

## Sentences

@slide
A sentence ends at sentence-ending punctuation followed by a newline.
This avoids abbreviation lists and works in any language.
Authors who write one sentence per line get exact boundaries.
@end

## Scoring

@slide[What earns points](rtext, steplists)
- First sentence
- Bold text
- Last sentence
- Shared words with the heading

![The disc.](../circle.svg) {#fig:score}
@end

@slide[Weights]
Scoring weights for the reducer. {#tab:weights}
| Signal | Weight |
| --- | ---: |
| First sentence | 2.0 |
| Bold text | 2.0 |
| Last sentence | 0.8 |
@end

# Results

@slide[Headline result](showrefs)
User satisfaction rose to 82% in the study @cite(gruber2004markdown).
@note(Say where the number comes from.)
@end

@slide[Summary](steplists)
- Select, never rewrite
- One sentence per line
- One file, two views
@end(Thank you.)
