import type { LanguageProfile } from "./types";

/** English. To support another language, add a file like this and register it in ./index.ts. */
export const en: LanguageProfile = {
  code: "en",
  leadIns: [
    "however", "moreover", "furthermore", "additionally", "in addition", "also", "therefore", "thus",
    "hence", "consequently", "meanwhile", "similarly", "likewise", "nevertheless", "nonetheless",
    "besides", "otherwise", "still", "then", "so",
  ],
  anaphora: ["this", "that", "these", "those", "it", "they", "he", "she", "such", "its", "their", "both"],
  ordinals: ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"],
  listPhrases: ["include", "includes", "including", "such as", "consist of", "consists of"],
  numberLeaders: ["to", "at", "by", "of", "from", "about", "around", "roughly", "nearly", "over", "under"],
  asideOpeners: [
    "which", "who", "whom", "whose", "where", "when", "although", "though", "while", "whereas", "including",
    "especially", "particularly", "e.g.", "i.e.", "for example", "for instance", "in particular", "according to",
    "as well as", "such as", "namely", "often", "usually", "typically",
  ],
  backgroundOpeners: [
    "while", "whilst", "although", "though", "even though", "even if", "whereas", "despite", "in spite of",
    "notwithstanding", "given that", "given the", "in addition to", "in contrast to", "in comparison with",
    "in comparison to", "compared with", "compared to", "as opposed to", "apart from", "aside from",
    "besides", "in light of", "with regard to", "with respect to",
  ],
  conjunctions: ["and", "or", "and also"],
};
