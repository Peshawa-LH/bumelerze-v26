/**
 * Type scale subset needed for the Phase-1 skeleton screens.
 * Full scale (magnitudeHero, body.large, etc.) is defined in
 * design-language.md §2 and will be added as the screens that need it are
 * built (event detail, felt-report flow — Phase 2+).
 *
 * Sizes are in sp (scale with the system font-size setting, per RN default).
 * Arabic-script text needs a taller line-height multiplier than Latin
 * (design-language.md §2 "Arabic-script line-height implication") — callers
 * pass `isArabicScript` to pick the right line-height.
 */
export interface TypeToken {
  fontSize: number;
  lineHeight: number;
  fontWeight:
    | "400"
    | "500"
    | "600"
    | "700"
    | "800";
}

function scale(fontSize: number, latinMultiplier: number, arabicMultiplier: number, fontWeight: TypeToken["fontWeight"], isArabicScript: boolean): TypeToken {
  return {
    fontSize,
    lineHeight: Math.round(fontSize * (isArabicScript ? arabicMultiplier : latinMultiplier)),
    fontWeight,
  };
}

export function typography(isArabicScript: boolean) {
  return {
    // Panic-mode emphasis tier (design-language.md §2): the single biggest
    // number on screen. Used only for the magnitude numeral, never for any
    // other content.
    magnitudeHero: scale(72, 1.15, 1.35, "800", isArabicScript),
    magnitudeCompact: scale(32, 1.2, 1.4, "700", isArabicScript),
    h1: scale(28, 1.25, 1.4, "700", isArabicScript),
    h2: scale(22, 1.3, 1.4, "600", isArabicScript),
    h3: scale(18, 1.35, 1.45, "600", isArabicScript),
    bodyDefault: scale(16, 1.5, 1.6, "400", isArabicScript),
    bodyMeta: scale(14, 1.4, 1.5, "400", isArabicScript),
    labelButton: scale(16, 1.2, 1.3, "600", isArabicScript),
    labelCaption: scale(12, 1.35, 1.45, "500", isArabicScript),
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
