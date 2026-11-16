/**
 * plugins/video-url.ts
 *
 * Which image destinations are really videos (REQ-141). The extension decides, ignoring case, query
 * string and fragment, so `![Pour](media/pour.MOV?v=2#t=3)` is a video.
 */

export const VIDEO_EXTENSIONS = ["mov", "mp4", "m4v", "webm", "ogv"] as const;

const VIDEO_RE = new RegExp(`\\.(?:${VIDEO_EXTENSIONS.join("|")})$`, "i");

export function isVideoUrl(url: string | undefined | null): boolean {
  if (!url) return false;
  return VIDEO_RE.test(url.split("#")[0].split("?")[0]);
}
