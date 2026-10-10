"use client";

/**
 * MusicAbc.tsx
 *
 * Client component mapped to the <music-abc> hast element emitted by
 * musicBlockHandler in plugins/music-blocks.ts.
 *
 * Renders the `notation` prop as sheet music using abcjs.
 * abcjs.renderAbc() clears the target element before rendering, so no
 * manual textContent reset is needed between renders.
 *
 * Usage in pipeline.ts:
 *   .use(rehypeReact, {
 *     ...,
 *     components: { "music-abc": MusicAbc },  // ← key must match tagName
 *   })
 */

import { useEffect, useRef } from "react";

interface MusicAbcProps {
  notation?: string;
  [key: string]: unknown; // rehypeReact may pass extra props
}

export default function MusicAbc({ notation }: MusicAbcProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current || !notation) return;
    import("abcjs").then((abcjs) => {
      if (!ref.current) return;
      abcjs.renderAbc(ref.current, notation, { responsive: "resize" });
    });
  }, [notation]);

  return <div ref={ref} className="music-abc-container" />;
}