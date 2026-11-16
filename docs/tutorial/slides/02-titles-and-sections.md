---
title: Titles and Sections
---

# Methods

A heading before a block names its slide, so the next slide is titled "Methods".

@slide
- Sample 40 documents
- Write each in Markdown
@end

@slide[A title of your own]
- `[Title]` after `@slide` overrides the heading
@end

@slide[]
- `[]` leaves the title blank on purpose
@end

# Results

@slide
- With no brackets the nearest heading is used again
@end

## Outline of the rest

A block that holds only headings is a divider. Neighbouring dividers merge into one agenda slide.

@slide
## First finding
@end

@slide
## Second finding
@end

@slide
## Third finding
@end

@slide[Thank you]
@end
