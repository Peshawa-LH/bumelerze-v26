import type { TextDirection } from "./index";

// Letters only: digits (also Eastern Arabic-Indic ones), punctuation and
// marks never decide.
const LETTER = /\p{L}/u;
// The right-to-left blocks: Hebrew, Arabic (with the Sorani and Persian
// letters), Syriac, Thaana, NKo and the Arabic presentation forms. Any
// other letter (Latin with Kurmanji's ê î û ç ş, Greek, Cyrillic) is left
// to right.
const RTL_BLOCK = /[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufefe]/u;
// Text inside directional isolates (U+2066-2068 ... U+2069) and @usernames
// (shown inside an isolate as links) do not decide a paragraph's
// direction, as in the Unicode bidi algorithm's rule P2.
const ISOLATED = /[\u2066-\u2068][^\u2069]*\u2069?|@[\p{L}\p{N}_.]+/gu;

/**
 * The direction a paragraph takes from its first strong letter, the way a
 * browser resolves `dir="auto"` / `unicode-bidi: plaintext`. Null when the
 * text has no letter at all (digits, emoji, punctuation): the caller keeps
 * the app language's direction then.
 */
export function firstStrongDirection(text: string): TextDirection | null {
  for (const character of text.replace(ISOLATED, "")) {
    if (LETTER.test(character)) {
      return RTL_BLOCK.test(character) ? "rtl" : "ltr";
    }
  }
  return null;
}
