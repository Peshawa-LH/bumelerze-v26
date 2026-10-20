import { Platform, type TextStyle } from "react-native";

/**
 * Type scale subset needed for the Phase-1 skeleton screens.
 * Full scale (magnitudeHero, body.large, etc.) is defined in
 * the design language §2 and will be added as the screens that need it are
 * built (event detail, felt-report flow — Phase 2+).
 *
 * Sizes are in sp (scale with the system font-size setting, per RN default).
 * Arabic-script text needs a taller line-height multiplier than Latin
 * (the design language §2 "Arabic-script line-height implication") — callers
 * pass `isArabicScript` to pick the right line-height.
 */
export interface TypeToken {
  fontSize: number;
  lineHeight: number;
  /** Set for Arabic-script locales (Vazirmatn, see `ARABIC_SCRIPT_FONT`);
   * undefined otherwise so Latin text keeps the platform font. */
  fontFamily?: string;
  /** iOS only: the reading start, stated explicitly (see
   * `READING_START`). Absent on the web and Android. */
  textAlign?: "left";
  fontWeight:
    | "400"
    | "500"
    | "600"
    | "700"
    | "800";
}

/**
 * The face every Arabic-script string renders in, on every platform.
 *
 * The app bundled no font at all until 2026-09-27 (`expo-font` installed,
 * never used), so Sorani fell to the OS fallback — and macOS/iOS fallbacks
 * lack the Kurdish-specific letter forms (ە ڵ ێ ۆ ڕ), substituting them
 * mid-word from another face. That is the owner's "the writing doesn't
 * align": the data was right, the glyphs were not (feedback 72ee4273).
 * Vazirmatn (SIL OFL, `assets/fonts/`) covers Sorani, Arabic and Persian
 * in one family. Loaded by `app/_layout.tsx`; on web the same family is
 * also applied document-wide for RTL locales by `src/i18n/index.ts`.
 */
export const ARABIC_SCRIPT_FONT = "Vazirmatn";

/** Weight -> the registered Vazirmatn face name (`useFonts` keys). RN
 * needs a distinct family per weight on Android; iOS/web resolve either. */
export function arabicScriptFontFor(fontWeight: TypeToken["fontWeight"]): string {
  if (fontWeight === "700" || fontWeight === "800") return `${ARABIC_SCRIPT_FONT}-Bold`;
  if (fontWeight === "600") return `${ARABIC_SCRIPT_FONT}-SemiBold`;
  if (fontWeight === "500") return `${ARABIC_SCRIPT_FONT}-Medium`;
  return `${ARABIC_SCRIPT_FONT}-Regular`;
}

/** Any React Native `fontWeight` as one of the token weights that have a
 * Vazirmatn face. */
function tokenWeight(fontWeight: TextStyle["fontWeight"]): TypeToken["fontWeight"] {
  const value = String(fontWeight ?? "400");
  if (value === "bold" || value === "heavy" || value === "black" || value === "condensedBold") {
    return "700";
  }
  if (value === "semibold") return "600";
  if (value === "medium") return "500";
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 500) return "400";
  if (numeric < 600) return "500";
  if (numeric < 700) return "600";
  return numeric < 800 ? "700" : "800";
}

/**
 * iOS/Android: the font family for text styled inline with a token's size
 * (`fontSize: typography.bodyMeta.fontSize`) instead of the whole token, so
 * Sorani and Arabic draw in Vazirmatn there too (item 44 of the iOS parity
 * inventory). Without it such text fell to the system face, which lacks the
 * Kurdish letter forms and swaps them in mid-word.
 *
 * `fontWeight` is the weight the text is drawn in when it differs from the
 * token's (an inline `fontWeight: "700"`, or `"400"` for a heading-sized
 * text with no weight of its own): the face has to match it, since iOS
 * picks the named face itself when the weight is regular.
 *
 * Undefined for Latin-script languages, while the faces are still loading
 * (the token has no family then), and always on the web: the web draws
 * every right-to-left page in Vazirmatn through one document rule
 * (`src/i18n/index.ts`), and naming a face inline there would change how
 * the web looks today.
 */
export function nativeFontFamily(
  token: TypeToken,
  fontWeight?: TextStyle["fontWeight"],
): string | undefined {
  if (Platform.OS === "web" || !token.fontFamily) {
    return undefined;
  }
  return arabicScriptFontFor(fontWeight === undefined ? token.fontWeight : tokenWeight(fontWeight));
}

/**
 * iOS: every token states the reading start as its alignment. Under a
 * right-to-left layout iOS swaps a physical `textAlign` (`"left"` is drawn
 * on the right, `RCTAttributedTextUtils.mm`), so `"left"` IS the reading
 * start in both directions. Without an alignment UIKit uses the "natural"
 * one, which follows the app's iOS language rather than the language
 * chosen in the app: Sorani picked in the app on an English phone put
 * paragraphs on the left under right-aligned headings, and English on an
 * Arabic phone put them on the right, until the next cold start applied the
 * app's iOS language (`src/i18n/apple-languages.ios.ts`). An explicit
 * alignment later in a style array still wins. The web and Android are left
 * as they were (react-native-web aligns to each paragraph's own start;
 * Android's natural alignment follows the text). Text styled inline
 * without a token spreads `READING_START` for the same result.
 */
export const READING_START: Pick<TypeToken, "textAlign"> =
  Platform.OS === "ios" ? { textAlign: "left" } : {};

function scale(
  fontSize: number,
  latinMultiplier: number,
  arabicMultiplier: number,
  fontWeight: TypeToken["fontWeight"],
  isArabicScript: boolean,
  withFace: boolean,
): TypeToken {
  return {
    fontSize,
    lineHeight: Math.round(fontSize * (isArabicScript ? arabicMultiplier : latinMultiplier)),
    fontWeight,
    ...(isArabicScript && withFace ? { fontFamily: arabicScriptFontFor(fontWeight) } : {}),
    ...READING_START,
  };
}

/**
 * The type scale for a script. `faceReady` (default true) is false on
 * iOS/Android while the Vazirmatn files are still being registered: the
 * family is named only once it can be drawn (see
 * `arabic-script-face.native.ts` for why naming it early cut labels short).
 */
export function typography(isArabicScript: boolean, faceReady = true) {
  const token = (
    fontSize: number,
    latinMultiplier: number,
    arabicMultiplier: number,
    fontWeight: TypeToken["fontWeight"],
  ) => scale(fontSize, latinMultiplier, arabicMultiplier, fontWeight, isArabicScript, faceReady);
  return {
    // Panic-mode emphasis tier (the design language §2): the single biggest
    // number on screen. Used only for the magnitude numeral, never for any
    // other content.
    magnitudeHero: token(72, 1.15, 1.35, "800"),
    magnitudeCompact: token(32, 1.2, 1.4, "700"),
    h1: token(28, 1.25, 1.4, "700"),
    h2: token(22, 1.3, 1.4, "600"),
    h3: token(18, 1.35, 1.45, "600"),
    bodyDefault: token(16, 1.5, 1.6, "400"),
    bodyMeta: token(14, 1.4, 1.5, "400"),
    labelButton: token(16, 1.2, 1.3, "600"),
    labelCaption: token(12, 1.35, 1.45, "500"),
  };
}

export const spacing = {
  0: 0,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
} as const;
