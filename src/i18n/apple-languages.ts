/**
 * The app's own language as iOS knows it (`apple-languages.ios.ts`). The web
 * and Android have no per-app system language to keep in step: no-ops.
 */

/** Tells iOS which language this app is in. */
export function setAppleLanguage(_locale: string): void {}

/** The language code of the app's iOS language, or null when unknown. */
export function currentAppleLanguage(): string | null {
  return null;
}

/** A language picked for the app in the iOS Settings app since the app
 * itself last set one, or null. */
export function appleLanguagePickedInSystemSettings(): string | null {
  return null;
}
