---
title: From Paragraphs to Slide Text
---

# Prose becomes slide text

A slide holds short text. When you write whole paragraphs, VFM picks the sentences worth showing and never rewrites them. Write one sentence per line, so that the line break marks where a sentence ends.

@slide[A long paragraph keeps two sentences]
Slides need terse text, but papers are written in long prose.
An extractive reducer keeps the author's own words.
It never adds anything of its own, and it leaves the rest in the file.
The sentences it does not pick are simply not on the slide.
@end

@slide[A bold paragraph is kept whole]
**Every word on a reduced slide occurs in the source paragraph.**
@end

@slide[Ordinals become a numbered list]
First, write one sentence per line.
Second, bold the sentences that matter.
Third, preview the slides.
@end

@slide[A colon introduces bullets]
The reducer understands several shapes: lists, steps, statistics, and plain prose.
@end

@slide[A number gets a callout]
Customer satisfaction with the generated slides rose to 82% in the user study.
@end

@slide[A line of dashes ends the slide]
The first part stays on this slide.

---

The second part starts a new slide, with no heading repeated.
@end
