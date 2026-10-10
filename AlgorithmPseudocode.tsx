"use client";

/**
 * AlgorithmPseudocode.tsx
 *
 * Client component mapped to the <algorithm-pseudocode> hast element emitted
 * by plugins/algorithm-blocks.ts's algorithmBlockHandler. Renders its `code`
 * prop (raw LaTeX-like pseudocode) using pseudocode.js
 * (https://github.com/SaswatPadhi/pseudocode.js).
 *
 * pseudocode.js mutates a live DOM node in place (it is not a pure function
 * of its input — it reads element.textContent and replaces it with rendered
 * KaTeX markup), so this only runs client-side via useEffect. On first paint
 * (and during SSR / StaticMarkdownRenderer) the raw pseudocode source is
 * shown until hydration runs the effect.
 *
 * Requires:
 *   npm install pseudocode katex
 *   import "katex/dist/katex.min.css"   (e.g. in app/layout.tsx)
 *   import "pseudocode/build/pseudocode.min.css"  (same)
 *
 * Usage in pipeline.ts:
 *   .use(rehypeReact, {
 *     ...,
 *     components: { "algorithm-pseudocode": AlgorithmPseudocode },
 *   })
 */

import { useEffect, useRef } from "react";
import {renderElement} from "pseudocode";

interface AlgorithmPseudocodeProps {
  code: string;
}

export default function AlgorithmPseudocode({ code }: AlgorithmPseudocodeProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    let cancelled = false;

    (async () => {
      if (cancelled || !ref.current) return;

      // Reset to the raw source before each render. Without this, re-renders
      // (e.g. triggered by registry context updates) would call
      // renderElement on an element whose textContent is already the
      // previously-rendered KaTeX output rather than the original source.
      ref.current.textContent = code;

      renderElement(ref.current, {
        indentSize: "1.2em",
        lineNumber: true,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [code]);

  // Initial / SSR fallback content: the raw pseudocode source, so something
  // readable is present before hydration runs.
  return (
    <div ref={ref} className="pseudocode-block">
      {code}
    </div>
  );
}