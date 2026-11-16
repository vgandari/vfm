---
title: Math, Diagrams, Code
---

# Things that are drawn

@slide[Math]
$$
\int_0^\infty e^{-x^2}\,dx = \frac{\sqrt{\pi}}{2}
$$
@end

@slide[A diagram]
```mermaid The pipeline
graph LR
  A[Markdown] --> B[Parse] --> C[Slides]
```
@end

@slide[An algorithm]
```alg Largest element
\begin{algorithm}
\begin{algorithmic}
\Procedure{Max}{$A$}
  \State $m \gets A_1$
  \For{$i = 2$ \To $n$}
    \If{$A_i > m$}
      \State $m \gets A_i$
    \EndIf
  \EndFor
  \State \Return $m$
\EndProcedure
\end{algorithmic}
\end{algorithm}
```
@end

@slide[A score]
```mus A scale
X:1
T:Scale
M:4/4
L:1/4
K:C
CDEF|GABc|
```
@end

@slide[Code]
```python
def vowels(s):
    return sum(c in "aeiou" for c in s.lower())
```
@end
