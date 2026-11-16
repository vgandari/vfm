"use client";

/**
 * MermaidDiagram.tsx
 *
 * Client component mapped to the <mermaid-diagram> element from plugins/mermaid-blocks.ts.
 *
 * Mermaid is loaded lazily and runs entirely in the page. It is configured so it cannot reach the
 * network: securityLevel "strict" (no scripts, no links, no external images in labels), no icon packs
 * registered (architecture diagrams would fetch those from a CDN), and no web fonts. Finished SVGs are
 * cached per source and theme, so re-renders (slide changes, live preview edits) show them at once.
 *
 * Until the SVG exists (and on the server) the diagram's source is shown as plain text.
 */

import { useEffect, useRef, useState } from "react";

interface Props {
  source?: string;
  [key: string]: unknown;
}

const cache = new Map<string, string>();
let counter = 0;
let loader: Promise<typeof import("mermaid").default> | undefined;

function isDark(): boolean {
  if (typeof document === "undefined") return false;
  const explicit = document.documentElement.dataset.theme;
  if (explicit) return explicit === "dark";
  return typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: dark)").matches;
}

async function load() {
  loader ??= import("mermaid").then((m) => m.default);
  return loader;
}

/** Renders `source` to an SVG string, or throws mermaid's parse error. */
export async function renderMermaid(source: string, dark = isDark(), forExport = false): Promise<string> {
  const key = `${dark ? "d" : "l"}${forExport ? "x" : ""}\n${source}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const mermaid = await load();
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: dark ? "dark" : "default",
    // The default stack names web fonts mermaid never downloads; use what the page already has.
    fontFamily: "inherit",
    // Plain SVG text (no <foreignObject>) so the picture can be drawn onto a canvas for export.
    ...(forExport ? { htmlLabels: false, flowchart: { htmlLabels: false } } : {}),
  });
  const { svg } = await mermaid.render(`vfm-mermaid-${++counter}`, source);
  cache.set(key, svg);
  return svg;
}

export default function MermaidDiagram({ source = "" }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const draw = () => {
      renderMermaid(source)
        .then((svg) => {
          if (!live || !ref.current) return;
          ref.current.innerHTML = svg;
          ref.current.dataset.rendered = "true";
          setError(null);
          // The diagram's size is now known: let a slide re-check that it fits.
          window.dispatchEvent(new Event("vfm-relayout"));
        })
        .catch((err) => {
          if (!live) return;
          setError(String((err as Error)?.message ?? err));
        });
    };
    draw();
    // Follow the light/dark switch.
    const mo = new MutationObserver(draw);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      live = false;
      mo.disconnect();
    };
  }, [source]);

  return (
    <div ref={ref} className="mermaid-container" title={error ? `Diagram could not be rendered: ${error}` : undefined}>
      <pre className={error ? "mermaid-error" : "mermaid-source"}>{source}</pre>
    </div>
  );
}
