/**
 * Language profile: the optional, language-specific half of the paragraph reducer
 * (see ../reducer.ts, which is language-independent and only reads these fields).
 * Every field may be empty; a language with no profile gets the language-independent behavior.
 */
export interface LanguageProfile {
  /** ISO 639-1 code, matched against the front matter's `lang:`. */
  code: string;
  /** Openers that only make sense after another sentence; stripped when leading and slightly penalized. */
  leadIns: string[];
  /** Sentence openers that point back at the previous sentence; a chosen one pulls that sentence in. */
  anaphora: string[];
  /** Step words for a process: first, second, ... in order. */
  ordinals: string[];
  /** Phrases that introduce a list, like the colon does. */
  listPhrases: string[];
  /** Words that lead a number ("rose to 4%"), dropped from a statistic's caption. */
  numberLeaders: string[];
  /** Words that open an aside between commas ("The pilot, which ran in three regions, exceeded…"); only such spans are dropped. */
  asideOpeners: string[];
  /**
   * Openers of a leading background clause or phrase ("While X, Y", "Despite X, Y"). The main clause
   * Y, after the first comma, is the part that deserves the bullet, so the opening part is dropped.
   */
  backgroundOpeners: string[];
  /** Conjunctions dropped from the front of the last list item. */
  conjunctions: string[];
}
