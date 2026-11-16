---
title: Citations, Notes and Footnotes
bibliography: ../tutorial.bib
---

# Sources

@slide[Citations with references](showrefs)
- Markdown began in 2004 @cite(gruber2004markdown)
- CommonMark made the rules exact @cite(macfarlane2024commonmark)
@note(Mention that the reference list is built from the bibliography file.)
@end

@slide[A repeated citation is listed once](showrefs)
- Gruber again @cite(gruber2004markdown)
- A new source @cite(knuth1984tex)
@note(Only the new source is added to this slide's list.)
@end

@slide[A footnote on a slide]
- Footnotes shown on a slide must be defined inside its block[^one]

[^one]: Defined between `@slide` and `@end`, so it shows on this slide.
@end
