/** Registered language profiles. */
import type { LanguageProfile } from "./types";
import { en } from "./en";

export type { LanguageProfile } from "./types";

export const PROFILES: Record<string, LanguageProfile> = { en };

/** Used when the front matter has no `lang:`. */
export const DEFAULT_LANGUAGE = "en";

/** The language code for a document: its declared `lang:` (primary subtag), else English. */
export function documentLanguage(declared?: string): string {
  return declared ? declared.toLowerCase().split(/[-_]/)[0] : DEFAULT_LANGUAGE;
}
