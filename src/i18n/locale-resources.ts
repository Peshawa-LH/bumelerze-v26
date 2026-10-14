import ar from "./locales/ar.json";
import ckb from "./locales/ckb.json";
import en from "./locales/en.json";
import kmr from "./locales/kmr.json";

/**
 * Translation files for i18next. iOS/Android: all four ship inside the app
 * and are ready at once. The web build has its own version
 * (`locale-resources.web.ts`) that carries English (the fallback) and
 * downloads only the language in use.
 */
// Loose on purpose: the four files share keys, not identical JSON types.
export type Translation = Record<string, unknown>;
export type LocaleCode = "en" | "ckb" | "kmr" | "ar";

const ALL: Record<LocaleCode, Translation> = { en, ckb, kmr, ar };

/** What i18next starts with: everything here. */
export function initialTranslations(): Partial<Record<LocaleCode, Translation>> {
  return ALL;
}

/** Already in memory here; the web version may have to download it. */
export function loadTranslation(locale: LocaleCode): Promise<Translation> {
  return Promise.resolve(ALL[locale]);
}
