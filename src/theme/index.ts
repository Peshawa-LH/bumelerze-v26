export { applyDocumentColorSchemeWeb, useTheme } from "./use-theme";
export type { Theme } from "./use-theme";
export type { SemanticColors } from "./semantic";
// Appearance preference (Settings > Appearance: Automatic/Light/Dark) —
// `useTheme` already resolves it into `scheme`; Settings is the one screen
// that needs the raw preference + setter to render the three buttons.
export { THEME_PREFERENCES, useThemePreferencesStore } from "./preferences-store";
export type { ThemePreference } from "./preferences-store";
// Brand-identity palette (icon/splash/favicon/website/store) — deliberately
// separate from the app's in-product semantic colors. See its doc comment
// in palette.ts before reaching for it in ordinary UI code.
export { logoBrand } from "./palette";
