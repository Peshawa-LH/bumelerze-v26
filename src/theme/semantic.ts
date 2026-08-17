/**
 * Layer 2 — semantic tokens.
 *
 * Components/screens read ONLY from here (via `useTheme`), never from
 * `palette.ts` directly (design-language.md §3 "three layers, not one").
 * Light values follow design-language.md §3; dark values follow §4
 * ("dark is the primary theme... true-black-leaning").
 */
import {
  actionRed,
  brand,
  damageGradeOnFillDark,
  damageGradeOnFillLight,
  damageGradePalette,
  intensityOnFillDark,
  intensityOnFillLight,
  intensityRamp,
  neutral,
  status,
} from "./palette";

export interface SemanticColors {
  surface: {
    base: string;
    raised: string;
    sunken: string;
    overlay: string;
  };
  text: {
    primary: string;
    secondary: string;
    tertiary: string;
    inverse: string;
    link: string;
  };
  border: {
    default: string;
    subtle: string;
  };
  brand: {
    primary: string;
    onPrimary: string;
  };
  action: {
    felt: string;
    feltOnFill: string;
  };
  status: {
    success: string;
    warning: string;
    danger: string;
    info: string;
  };
  /** Index 1..12 = EMS-98 I..XII. Index 0 is an unused placeholder. */
  intensity: readonly string[];
  intensityOnFill: readonly string[];
  /** Index 1..5 = DG1..DG5 building-damage grade. Index 0 is an unused
   * placeholder. Own palette, not sampled from `intensity` — see
   * `palette.ts`'s `damageGradePalette` doc comment. */
  damageGrade: readonly string[];
  damageGradeOnFill: readonly string[];
}

export const lightColors: SemanticColors = {
  surface: {
    base: neutral[0],
    raised: neutral[100],
    sunken: neutral[200],
    overlay: "rgba(22, 22, 22, 0.5)",
  },
  text: {
    primary: neutral[1100],
    secondary: neutral[700],
    // neutral[650], not neutral[500] — see palette.ts's doc comment on
    // neutral[650] (WCAG-AA contrast fix, accessibility-tester Phase 5).
    tertiary: neutral[650],
    inverse: neutral[0],
    link: brand.primaryLight,
  },
  border: {
    default: neutral[300],
    subtle: neutral[200],
  },
  brand: {
    primary: brand.primaryLight,
    onPrimary: neutral[0],
  },
  action: {
    felt: actionRed.light,
    feltOnFill: neutral[0],
  },
  status,
  intensity: intensityRamp,
  intensityOnFill: intensityOnFillLight,
  damageGrade: damageGradePalette,
  damageGradeOnFill: damageGradeOnFillLight,
};

export const darkColors: SemanticColors = {
  surface: {
    base: "#000000",
    raised: "#141414",
    sunken: "#1E1E1E",
    overlay: "rgba(0, 0, 0, 0.6)",
  },
  text: {
    primary: "#F2F2F3",
    secondary: "#A6A6AA",
    // neutral[600], not neutral[700] — neutral[700] ("#5B5B5E") only reaches
    // ~3.1:1 against this theme's true-black surface.base, below the 4.5:1
    // normal-text floor; neutral[600] reaches ~5.72:1 (same WCAG-AA fix as
    // the light theme's text.tertiary, accessibility-tester Phase 5).
    tertiary: neutral[600],
    inverse: neutral[1100],
    link: brand.primaryDark,
  },
  border: {
    default: "#2A2A2C",
    subtle: "#1E1E1E",
  },
  brand: {
    primary: brand.primaryDark,
    // WCAG-AA contrast fix (accessibility-tester Phase 5 audit): dark text
    // (neutral[1100]) on `brand.primaryDark` ("#3E7C93") measures only
    // ~3.89:1 — a real fail of the 4.5:1 normal-text floor on the primary
    // CTA button text used on nearly every onboarding/felt-report screen.
    // White text on the same fill reaches ~4.66:1. This only changes the
    // on-fill text choice, not the brand hue itself (`brand.primaryDark` is
    // still the explicitly-flagged "owner review pending" placeholder in
    // palette.ts — not this audit's call to redecide).
    onPrimary: neutral[0],
  },
  action: {
    felt: actionRed.dark,
    feltOnFill: neutral[1100],
  },
  status,
  intensity: intensityRamp,
  intensityOnFill: intensityOnFillDark,
  damageGrade: damageGradePalette,
  damageGradeOnFill: damageGradeOnFillDark,
};
