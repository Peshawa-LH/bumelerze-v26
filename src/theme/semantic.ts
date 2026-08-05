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
  intensityOnFillDark,
  intensityOnFillLight,
  intensityRampDark,
  intensityRampLight,
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
    tertiary: neutral[500],
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
  intensity: intensityRampLight,
  intensityOnFill: intensityOnFillLight,
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
    tertiary: neutral[700],
    inverse: neutral[1100],
    link: brand.primaryDark,
  },
  border: {
    default: "#2A2A2C",
    subtle: "#1E1E1E",
  },
  brand: {
    primary: brand.primaryDark,
    onPrimary: neutral[1100],
  },
  action: {
    felt: actionRed.dark,
    feltOnFill: neutral[1100],
  },
  status,
  intensity: intensityRampDark,
  intensityOnFill: intensityOnFillDark,
};
