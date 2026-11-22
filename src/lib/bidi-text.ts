/**
 * Removes the Unicode embedding, override and isolate controls (U+202A to
 * U+202E, U+2066 to U+2069) from text people type for others to read: a
 * display name, a bio, a post or a comment. With them, "official" text can be
 * made to read differently from what it is (security audit APP-09). Kept on
 * purpose: ZWNJ and ZWJ (U+200C, U+200D), which Kurdish and Arabic need for
 * shaping, and the single marks LRM and RLM (U+200E, U+200F), which cannot
 * reverse a run of text. The server removes the same characters
 * (`strip_bidi_controls`, migration 0080); this copy keeps what the app shows
 * right after saving equal to what the server stored.
 */
const BIDI_CONTROLS = /[‪-‮⁦-⁩]/g;

export function stripBidiControls(text: string): string {
  return text.replace(BIDI_CONTROLS, "");
}
