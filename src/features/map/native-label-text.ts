/**
 * Sorani label text in the form MapLibre Native shapes correctly.
 *
 * MapLibre Native joins Arabic-script letters with its bundled ICU shaper,
 * the same one the web's RTL plugin compiles to wasm, and it has the same
 * gap `arabic-presentation.ts` documents for the web: it treats ە (U+06D5)
 * as a letter that joins nothing, so the letter before it falls back to its
 * isolated form (هەولێر came out as "ەەولێر" on the simulator, 2026-10-20),
 * and it leaves ێ (U+06CE) and ڵ (U+06B5) unjoined.
 *
 * The web fixes this after ICU, inside the plugin. Native has no hook there,
 * and pre-shaped presentation forms do not survive either (ICU folds them
 * back to base letters before it shapes). What does survive is spelling
 * each letter with ones ICU knows, measured on the simulator the same day:
 *
 * - ە → ه + ZWNJ (U+200C). The traditional Sorani keyboard spelling: heh
 *   joins the letter before it, and the non-joiner stops it joining the
 *   next, which is exactly how ە behaves. Isolated and final heh are the
 *   glyphs ە is drawn with.
 * - ێ → ی + small v above (U+065A), and ڵ → ل + small v above: the base
 *   letter joins on both sides and the mark sits on it. The web draws ڵ
 *   the same way.
 *
 * Only labels this app supplies itself (its own place names) can be
 * rewritten; basemap tile text keeps the shaper's output.
 */
const ARABIC_AE = "ە";
const YEH_WITH_SMALL_V = "ێ";
const LAM_WITH_SMALL_V = "ڵ";

const HEH = "ه";
const ZERO_WIDTH_NON_JOINER = "‌";
const FARSI_YEH = "ی";
const LAM = "ل";
const SMALL_V_ABOVE = "ٚ";

const NEEDS_RESPELLING = /[ەێڵ]/;

/** `text` with ە, ێ and ڵ respelled as above; anything else unchanged. */
export function toMapLibreNativeLabel(text: string): string {
  if (!NEEDS_RESPELLING.test(text)) return text;
  return text
    .split(ARABIC_AE)
    .join(HEH + ZERO_WIDTH_NON_JOINER)
    .split(YEH_WITH_SMALL_V)
    .join(FARSI_YEH + SMALL_V_ABOVE)
    .split(LAM_WITH_SMALL_V)
    .join(LAM + SMALL_V_ABOVE);
}
