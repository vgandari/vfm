/**
 * slides/domMeasurer.ts
 *
 * The browser Measurer. A candidate slide is rendered into an off-screen stage of the real slide
 * size and tested for overflow with `slideFits`, so what the splitter decides is what the audience
 * sees. Needs a DOM; use `estimateFits` where there is none.
 */

import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import type { Measurer } from "./measure";
import { slideFits } from "./fit";
import { STAGE_WIDTH, STAGE_HEIGHT } from "../constants";

/**
 * `stageClass` must give the stage the slide typography the host shows, normally
 * `${styles.markdownBody} vfm-body vfm-stage-wrap`. The stage is created on first use and reused.
 */
export function createDomMeasurer(stageClass: string): Measurer {
  let stage: { host: HTMLDivElement; root: Root } | null = null;
  const get = () => {
    if (!stage) {
      const host = document.createElement("div");
      host.className = stageClass;
      host.setAttribute("aria-hidden", "true");
      Object.assign(host.style, {
        position: "fixed",
        left: "-10000px",
        top: "0",
        width: `${STAGE_WIDTH}px`,
        height: `${STAGE_HEIGHT}px`,
        visibility: "hidden",
        pointerEvents: "none",
        background: "transparent",
      });
      document.body.appendChild(host);
      stage = { host, root: createRoot(host) };
    }
    return stage;
  };
  return (slide, render) => {
    const { host, root } = get();
    flushSync(() => root.render(render()));
    // Title, lead-in and references are fixed-size, so a full slide shows up as an overflowing region.
    return slideFits(host, slide.layout === "2col");
  };
}
