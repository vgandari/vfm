"use client";

/**
 * MusicAbc.tsx
 *
 * Client component mapped to the <music-abc> hast element emitted by
 * musicBlockHandler in plugins/music-blocks.ts.
 *
 * Renders the `notation` prop as sheet music using abcjs, with a Play button that sounds the tune
 * through Web Audio (see music-audio.ts: synthesized tones, nothing is downloaded).
 * abcjs.renderAbc() clears the target element before rendering, so no
 * manual textContent reset is needed between renders.
 *
 * Usage in pipeline.ts:
 *   .use(rehypeReact, {
 *     ...,
 *     components: { "music-abc": MusicAbc },  // ← key must match tagName
 *   })
 */

import { useEffect, useRef, useState } from "react";
// Static, not import(): the slide fit test renders synchronously and must see the finished score.
import * as abcjs from "abcjs";
import { createPlayer, midiToNotes, type Player } from "./music-audio";

interface MusicAbcProps {
  notation?: string;
  [key: string]: unknown; // rehypeReact may pass extra props
}

export default function MusicAbc({ notation }: MusicAbcProps) {
  const ref = useRef<HTMLDivElement>(null);
  const player = useRef<Player | null>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!ref.current || !notation) return;
    abcjs.renderAbc(ref.current, notation, { responsive: "resize" });
  }, [notation]);

  // The score may change or leave the page (next slide) while playing.
  useEffect(() => () => player.current?.stop(), [notation]);

  const toggle = () => {
    player.current ??= createPlayer();
    const p = player.current;
    if (p.playing) return p.stop();
    try {
      const midi = abcjs.synth.getMidiFile(notation ?? "", { midiOutputType: "binary" }) as unknown as Uint8Array[];
      setPlaying(true);
      p.play(midiToNotes(midi[0]), () => setPlaying(false));
    } catch {
      setPlaying(false);
    }
  };

  return (
    <div className="music-abc-wrap">
      <div ref={ref} className="music-abc-container" />
      {notation && (
        <button type="button" className="music-play" onClick={toggle} title={playing ? "Stop" : "Play"} aria-label={playing ? "Stop" : "Play"}>
          {playing ? "■ Stop" : "▶ Play"}
        </button>
      )}
    </div>
  );
}
