export { applyDocumentColorSchemeWeb, useTheme } from "./use-theme";
// iOS: the reading start as an explicit `textAlign` (empty elsewhere), for
// text styled inline rather than with a whole typography token.
export { READING_START } from "./typography";
// iOS/Android: the Vazirmatn face for text styled inline with a token's size
// (undefined on the web and for Latin-script languages).
export { nativeFontFamily } from "./typography";
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
