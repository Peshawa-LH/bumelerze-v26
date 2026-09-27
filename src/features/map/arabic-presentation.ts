/**
 * Pre-shapes Arabic-script text into Unicode presentation forms (U+FB50–
 * U+FEFF) before it is handed to MapLibre as a label.
 *
 * Why this exists: MapLibre renders one glyph per code point and leaves
 * Arabic joining to the RTL text plugin, whose shaper (ICU's
 * `u_shapeArabic`, compiled to wasm) predates Sorani's letters. Measured
 * on the shipped plugin, 2026-09-27: it treats ە (U+06D5) as NON-joining,
 * so the letter before it falls back to its isolated form — هەولێر came
 * out with an isolated ه, which reads as "ەەولێر" — and it leaves ێ
 * (U+06CE) and ڵ (U+06B5) unshaped, so their neighbours cannot connect.
 * Every other letter it shapes correctly.
 *
 * Presentation forms pass through the plugin untouched, so shaping here,
 * with a joining table that knows the Kurdish letters, leaves it only the
 * bidi reordering to do. This is the standard Unicode joining algorithm
 * (UAX #9 / Arabic joining types) restricted to the letters Sorani, Arabic
 * and Persian place names use; anything not in the table passes through.
 *
 * Two letters have no presentation forms at all:
 * - ە (U+06D5) is right-joining; its isolated and final glyphs differ only
 *   by the connecting stroke, so the base code point is drawn and the
 *   letter BEFORE it is what this module gets right.
 * - ڵ (U+06B5) is dual-joining; it is drawn as the matching lam form with
 *   the combining small v (U+065A) on top, so it connects on both sides.
 */

/** Joining behaviour: D = dual (both sides), R = right only, U = none. */
type Joining = "D" | "R" | "U";

interface LetterForms {
  joining: Joining;
  /** [isolated, final, initial, medial]; a right-joining letter has only
   * the first two. `null` keeps the base code point for that form. */
  forms: readonly (number | null)[];
}

const FORMS = new Map<number, LetterForms>([
  // Standard Arabic
  [0x0621, { joining: "U", forms: [0xfe80] }],
  [0x0622, { joining: "R", forms: [0xfe81, 0xfe82] }],
  [0x0623, { joining: "R", forms: [0xfe83, 0xfe84] }],
  [0x0624, { joining: "R", forms: [0xfe85, 0xfe86] }],
  [0x0625, { joining: "R", forms: [0xfe87, 0xfe88] }],
  [0x0626, { joining: "D", forms: [0xfe89, 0xfe8a, 0xfe8b, 0xfe8c] }],
  [0x0627, { joining: "R", forms: [0xfe8d, 0xfe8e] }],
  [0x0628, { joining: "D", forms: [0xfe8f, 0xfe90, 0xfe91, 0xfe92] }],
  [0x0629, { joining: "R", forms: [0xfe93, 0xfe94] }],
  [0x062a, { joining: "D", forms: [0xfe95, 0xfe96, 0xfe97, 0xfe98] }],
  [0x062b, { joining: "D", forms: [0xfe99, 0xfe9a, 0xfe9b, 0xfe9c] }],
  [0x062c, { joining: "D", forms: [0xfe9d, 0xfe9e, 0xfe9f, 0xfea0] }],
  [0x062d, { joining: "D", forms: [0xfea1, 0xfea2, 0xfea3, 0xfea4] }],
  [0x062e, { joining: "D", forms: [0xfea5, 0xfea6, 0xfea7, 0xfea8] }],
  [0x062f, { joining: "R", forms: [0xfea9, 0xfeaa] }],
  [0x0630, { joining: "R", forms: [0xfeab, 0xfeac] }],
  [0x0631, { joining: "R", forms: [0xfead, 0xfeae] }],
  [0x0632, { joining: "R", forms: [0xfeaf, 0xfeb0] }],
  [0x0633, { joining: "D", forms: [0xfeb1, 0xfeb2, 0xfeb3, 0xfeb4] }],
  [0x0634, { joining: "D", forms: [0xfeb5, 0xfeb6, 0xfeb7, 0xfeb8] }],
  [0x0635, { joining: "D", forms: [0xfeb9, 0xfeba, 0xfebb, 0xfebc] }],
  [0x0636, { joining: "D", forms: [0xfebd, 0xfebe, 0xfebf, 0xfec0] }],
  [0x0637, { joining: "D", forms: [0xfec1, 0xfec2, 0xfec3, 0xfec4] }],
  [0x0638, { joining: "D", forms: [0xfec5, 0xfec6, 0xfec7, 0xfec8] }],
  [0x0639, { joining: "D", forms: [0xfec9, 0xfeca, 0xfecb, 0xfecc] }],
  [0x063a, { joining: "D", forms: [0xfecd, 0xfece, 0xfecf, 0xfed0] }],
  [0x0641, { joining: "D", forms: [0xfed1, 0xfed2, 0xfed3, 0xfed4] }],
  [0x0642, { joining: "D", forms: [0xfed5, 0xfed6, 0xfed7, 0xfed8] }],
  [0x0643, { joining: "D", forms: [0xfed9, 0xfeda, 0xfedb, 0xfedc] }],
  [0x0644, { joining: "D", forms: [0xfedd, 0xfede, 0xfedf, 0xfee0] }],
  [0x0645, { joining: "D", forms: [0xfee1, 0xfee2, 0xfee3, 0xfee4] }],
  [0x0646, { joining: "D", forms: [0xfee5, 0xfee6, 0xfee7, 0xfee8] }],
  [0x0647, { joining: "D", forms: [0xfee9, 0xfeea, 0xfeeb, 0xfeec] }],
  [0x0648, { joining: "R", forms: [0xfeed, 0xfeee] }],
  [0x0649, { joining: "R", forms: [0xfeef, 0xfef0] }],
  [0x064a, { joining: "D", forms: [0xfef1, 0xfef2, 0xfef3, 0xfef4] }],
  // Persian / Kurdish additions
  [0x067e, { joining: "D", forms: [0xfb56, 0xfb57, 0xfb58, 0xfb59] }],
  [0x0686, { joining: "D", forms: [0xfb7a, 0xfb7b, 0xfb7c, 0xfb7d] }],
  [0x0698, { joining: "R", forms: [0xfb8a, 0xfb8b] }],
  [0x06a9, { joining: "D", forms: [0xfb8e, 0xfb8f, 0xfb90, 0xfb91] }],
  [0x06af, { joining: "D", forms: [0xfb92, 0xfb93, 0xfb94, 0xfb95] }],
  [0x06be, { joining: "D", forms: [0xfbaa, 0xfbab, 0xfbac, 0xfbad] }],
  [0x06c6, { joining: "R", forms: [0xfbd9, 0xfbda] }],
  [0x06cc, { joining: "D", forms: [0xfbfc, 0xfbfd, 0xfbfe, 0xfbff] }],
  [0x06ce, { joining: "D", forms: [0xfbe4, 0xfbe5, 0xfbe6, 0xfbe7] }],
  [0x06d5, { joining: "R", forms: [null, null] }],
  [0x0695, { joining: "R", forms: [null, null] }],
  [0x06b5, { joining: "D", forms: [null, null, null, null] }],
]);

const LAM = 0x0644;
const LAM_WITH_V = 0x06b5;
const SMALL_V_ABOVE = 0x065a;
/** Lam-alef ligatures: alef variant → [isolated, final]. */
const LAM_ALEF = new Map<number, readonly [number, number]>([
  [0x0622, [0xfef5, 0xfef6]],
  [0x0623, [0xfef7, 0xfef8]],
  [0x0625, [0xfef9, 0xfefa]],
  [0x0627, [0xfefb, 0xfefc]],
]);
/** Combining marks sit on their base without affecting joining. */
function isTransparent(cp: number): boolean {
  return (
    (cp >= 0x064b && cp <= 0x065f) || cp === 0x0670 || (cp >= 0x06d6 && cp <= 0x06ed)
  );
}

/**
 * Returns `text` with every letter it knows replaced by the presentation
 * form its position calls for. Idempotent: presentation forms are not in
 * the table, so shaped text passes through unchanged.
 */
export function toPresentationForms(text: string): string {
  const cps = Array.from(text, (ch) => ch.codePointAt(0) ?? 0);
  // Joining neighbours skip transparent marks.
  const prevLetter = (i: number): LetterForms | undefined => {
    for (let j = i - 1; j >= 0; j -= 1) {
      const cp = cps[j] ?? 0;
      if (isTransparent(cp)) continue;
      return FORMS.get(cp);
    }
    return undefined;
  };
  const nextLetter = (i: number): LetterForms | undefined => {
    for (let j = i + 1; j < cps.length; j += 1) {
      const cp = cps[j] ?? 0;
      if (isTransparent(cp)) continue;
      return FORMS.get(cp);
    }
    return undefined;
  };

  const out: number[] = [];
  for (let i = 0; i < cps.length; i += 1) {
    const cp = cps[i] ?? 0;
    const letter = FORMS.get(cp);
    if (!letter) {
      out.push(cp);
      continue;
    }
    const prev = prevLetter(i);
    const next = nextLetter(i);
    const joinsRight = prev !== undefined && prev.joining === "D";
    const joinsLeft =
      letter.joining === "D" && next !== undefined && next.joining !== "U";

    // Lam + alef collapse into one ligature glyph.
    if (cp === LAM && next !== undefined) {
      const nextIndex = cps.findIndex((c, j) => j > i && !isTransparent(c));
      const ligature = LAM_ALEF.get(cps[nextIndex] ?? -1);
      if (ligature) {
        out.push(joinsRight ? ligature[1] : ligature[0]);
        i = nextIndex;
        continue;
      }
    }

    const formIndex = joinsRight ? (joinsLeft ? 3 : 1) : joinsLeft ? 2 : 0;
    if (cp === LAM_WITH_V) {
      const lam = FORMS.get(LAM);
      out.push(lam?.forms[formIndex] ?? cp, SMALL_V_ABOVE);
      continue;
    }
    out.push(letter.forms[formIndex] ?? cp);
  }
  return String.fromCodePoint(...out);
}

/** Presentation form → base code point(s), for undoing the plugin's pass. */
const TO_BASE = new Map<number, readonly number[]>();
for (const [base, letter] of FORMS) {
  for (const form of letter.forms) {
    if (form !== null) TO_BASE.set(form, [base]);
  }
}
for (const [alef, [isolated, final]] of LAM_ALEF) {
  TO_BASE.set(isolated, [LAM, alef]);
  TO_BASE.set(final, [LAM, alef]);
}

/** Letters the shipped RTL plugin's shaper gets wrong (see module doc). */
const KURDISH_LETTER = /[\u06D5\u06CE\u06B5]/;

/**
 * Runs AFTER the RTL plugin's own shaping (which de-shapes and re-shapes
 * whatever it is given, so pre-shaping cannot survive it): undoes its
 * presentation forms and redoes the joining with the Kurdish letters
 * known. Text without one of those letters is returned untouched, so
 * Arabic labels stay exactly as ICU shaped them.
 */
export function reshapeForKurdish(text: string): string {
  if (!KURDISH_LETTER.test(text)) return text;
  const base: number[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    // A lam form followed by the small v is our own ڵ coming back round.
    base.push(...(TO_BASE.get(cp) ?? [cp]));
  }
  const collapsed: number[] = [];
  for (let i = 0; i < base.length; i += 1) {
    const cp = base[i] ?? 0;
    if (cp === LAM && base[i + 1] === SMALL_V_ABOVE) {
      collapsed.push(LAM_WITH_V);
      i += 1;
      continue;
    }
    collapsed.push(cp);
  }
  return toPresentationForms(String.fromCodePoint(...collapsed));
}
