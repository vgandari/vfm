"use client";

/**
 * AlgorithmPseudocode.tsx
 *
 * Client component mapped to the <algorithm-pseudocode> hast element emitted
 * by plugins/algorithm-blocks.ts's algorithmBlockHandler. Renders its `code`
 * prop (raw LaTeX-like pseudocode) using pseudocode.js
 * (https://github.com/SaswatPadhi/pseudocode.js).
 *
 * pseudocode.js needs a browser (it measures nothing, but its markup uses KaTeX), so the markup is
 * produced in a useEffect and set as this node's children. renderToString() is used rather than
 * renderElement(): the latter replaces the node React owns with its own, and React then throws
 * when it later tries to remove the detached node (the slideshow did this on every slide change).
 * On first paint (and during SSR / StaticMarkdownRenderer) the raw pseudocode source is shown.
 *
 * Requires:
 *   npm install pseudocode katex
 *   import "katex/dist/katex.min.css"   (e.g. in app/layout.tsx)
 *   import "markdown/pseudocode.css"  (same; NOT pseudocode/build/pseudocode.min.css, which @imports
 *   KaTeX's stylesheet from cdnjs and so fetches from the internet)
 *
 * Usage in pipeline.ts:
 *   .use(rehypeReact, {
 *     ...,
 *     components: { "algorithm-pseudocode": AlgorithmPseudocode },
 *   })
 */

import { useEffect, useRef } from "react";
import { renderToString } from "pseudocode";

interface AlgorithmPseudocodeProps {
  code: string;
}

export default function AlgorithmPseudocode({ code }: AlgorithmPseudocodeProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    // Render to markup and set it as the children of our own node. pseudocode's renderElement()
    // would replace this node with its own, and React then fails to remove the detached node when
    // the algorithm unmounts (for example when the slideshow moves to the next slide).
    try {
      ref.current.innerHTML = renderToString(code, {
        indentSize: "1.2em",
        lineNumber: true,
        // pseudocode.js keeps one global caption counter that every render increments, so
        // re-renders and slide measurements would number this "Algorithm 7". Start from 0 each time.
        captionCount: 0,
      });
    } catch (err) {
      // Leave the raw source in place, with the reason on hover.
      ref.current.textContent = code;
      ref.current.title = `Algorithm could not be rendered: ${(err as Error)?.message ?? err}`;
      console.error("AlgorithmPseudocode: could not render", err);
    }
  }, [code]);

  // Initial / SSR fallback content: the raw pseudocode source, so something
  // readable is present before the effect runs.
  return (
    <div ref={ref} className="pseudocode-block">
      {code}
    </div>
  );
}
