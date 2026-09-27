import { Platform, useColorScheme } from "react-native";
import { useTranslation } from "react-i18next";

import { ARABIC_SCRIPT_LOCALES } from "@/i18n";
import { useThemePreferencesStore } from "./preferences-store";
import { darkColors, lightColors, type SemanticColors } from "./semantic";
import { spacing, typography } from "./typography";

export interface Theme {
  scheme: "light" | "dark";
  colors: SemanticColors;
  typography: ReturnType<typeof typography>;
  spacing: typeof spacing;
}

/**
 * Web-only: mirrors the resolved scheme onto the DOM, same idea as
 * `src/i18n/index.ts`'s `applyDocumentDirWeb` for reading direction.
 * `color-scheme` fixes native form controls/scrollbars to match; the
 * `data-theme` attribute is a hook for any plain CSS this app ever needs
 * outside react-native-web's inline styles. No-ops on native and during
 * SSR/static-export's node render pass. Exported so `app/_layout.tsx` — the
 * one place mounted for the app's whole lifetime — can call it from a
 * `useEffect` instead of every `useTheme()` call site re-running the same
 * DOM write on every render.
 */
export function applyDocumentColorSchemeWeb(scheme: Theme["scheme"]): void {
  if (Platform.OS !== "web") {
    return;
  }
  try {
    if (typeof document === "undefined" || !document.documentElement) {
      return;
    }
    document.documentElement.style.colorScheme = scheme;
    document.documentElement.setAttribute("data-theme", scheme);
  } catch {
    // Best-effort only — never let this crash boot or a theme switch.
  }
}

/**
 * Layer 3 — component usage.
 * Resolves the user's Settings > Appearance choice (owner, 2026-09-27:
 * Automatic/Light/Dark) — "auto" (the default) follows the system color
 * scheme exactly as this hook always did; "light"/"dark" override it. Also
 * honors the active locale's script (Arabic-script locales need taller line
 * heights, design-language.md §2). Components should never import
 * palette/semantic files directly — always go through this hook.
 */
export function useTheme(): Theme {
  const systemScheme = useColorScheme();
  const { i18n } = useTranslation();
  const preference = useThemePreferencesStore((state) => state.preference);
  const systemAsScheme: Theme["scheme"] = systemScheme === "dark" ? "dark" : "light";
  const scheme: Theme["scheme"] = preference === "auto" ? systemAsScheme : preference;
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
