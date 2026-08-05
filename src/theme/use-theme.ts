import { useColorScheme } from "react-native";
import { useTranslation } from "react-i18next";

import { ARABIC_SCRIPT_LOCALES } from "@/i18n";
import { darkColors, lightColors, type SemanticColors } from "./semantic";
import { spacing, typography } from "./typography";

export interface Theme {
  scheme: "light" | "dark";
  colors: SemanticColors;
  typography: ReturnType<typeof typography>;
  spacing: typeof spacing;
}

/**
 * Layer 3 — component usage.
 * Honors the system color scheme (dark is the primary theme, design-language
 * §4) and the active locale's script (Arabic-script locales need taller line
 * heights, §2). Components should never import palette/semantic files
 * directly — always go through this hook.
 */
export function useTheme(): Theme {
  const systemScheme = useColorScheme();
  const { i18n } = useTranslation();
  const scheme: Theme["scheme"] = systemScheme === "dark" ? "dark" : "light";
  const isArabicScript = ARABIC_SCRIPT_LOCALES.includes(
    i18n.language as (typeof ARABIC_SCRIPT_LOCALES)[number],
  );

  return {
    scheme,
    colors: scheme === "dark" ? darkColors : lightColors,
    typography: typography(isArabicScript),
    spacing,
  };
}
