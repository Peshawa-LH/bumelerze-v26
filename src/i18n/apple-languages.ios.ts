import { Settings } from "react-native";

import { appLanguageCode } from "./language-codes";

/**
 * iOS: the app's language as the system knows it, kept equal to the language
 * chosen in the app.
 *
 * iOS lets every app have its own language (Settings > Bumelerze >
 * Language), stored as `AppleLanguages` in the app's own user defaults. It
 * decides what UIKit does for the app: the "natural" text alignment of every
 * paragraph without an explicit `textAlign` (right for Sorani and Arabic,
 * left otherwise), the language and direction of system texts (menus,
 * pickers, alerts, permission prompts) and the first entry of
 * `Localization.getLocales()`.
 *
 * Without this, picking Sorani in the app on an English phone mirrored the
 * layout (`I18nManager.forceRTL`) but left every such paragraph on the LEFT
 * edge, under right-aligned headings (seen on the iOS Simulator,
 * 2026-10-20). iOS reads the value when the app process starts, so a change
 * applies from the next launch; a JS reload is not enough. Typography tokens
 * therefore also carry an explicit reading-start alignment on iOS
 * (`src/theme/typography.ts`) for the session in between.
 *
 * Written only when the person CHOOSES a language: until then the app
 * follows the phone, and a stored value would freeze it to the language of
 * the first launch.
 */

/** Our own record of the last language written, to tell a change made in the
 * iOS Settings app (which writes `AppleLanguages` and restarts the app) from
 * our own write. */
const WRITTEN_KEY = "bumelerze.appleLanguage";

function readSetting(key: string): unknown {
  try {
    return Settings.get(key);
  } catch {
    // No settings module (a test environment): nothing known.
    return undefined;
  }
}

export function setAppleLanguage(locale: string): void {
  try {
    Settings.set({ AppleLanguages: [locale], [WRITTEN_KEY]: locale });
  } catch {
    // Best effort: the layout direction is pinned separately.
  }
}

export function currentAppleLanguage(): string | null {
  const languages = readSetting("AppleLanguages");
  // "ku" (iOS's Kurdish) is the app's Kurmanji, "kmr".
  return Array.isArray(languages) ? appLanguageCode(languages[0]) : null;
}

export function appleLanguagePickedInSystemSettings(): string | null {
  const written = readSetting(WRITTEN_KEY);
  if (typeof written !== "string") {
    // The app never set one: the phone's own language list, not a pick.
    return null;
  }
  const current = currentAppleLanguage();
  return current !== null && current !== written ? current : null;
}
