import en from "./locales/en.json";

/**
 * Web version of `locale-resources.ts`. The four translation files together
 * are about 1 MB of script; a visitor needs one. English stays in the first
 * download (it is i18next's fallback); Sorani, Kurmanji and Arabic are each
 * their own file, fetched before the first screen when that language is in
 * use (see `ensureLocaleLoaded` in `index.ts`).
 */
// Loose on purpose: the four files share keys, not identical JSON types.
export type Translation = Record<string, unknown>;
export type LocaleCode = "en" | "ckb" | "kmr" | "ar";

export function initialTranslations(): Partial<Record<LocaleCode, Translation>> {
  return { en };
}

export async function loadTranslation(locale: LocaleCode): Promise<Translation> {
  switch (locale) {
    case "ckb":
      return unwrap(await import("./locales/ckb.json"));
    case "kmr":
      return unwrap(await import("./locales/kmr.json"));
    case "ar":
      return unwrap(await import("./locales/ar.json"));
    default:
      return en;
  }
}

function unwrap(module: unknown): Translation {
  const value = module as { default?: unknown };
  return (value.default ?? value) as Translation;
}
