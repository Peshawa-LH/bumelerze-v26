import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Localization from "expo-localization";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { I18nManager } from "react-native";

import ar from "./locales/ar.json";
import ckb from "./locales/ckb.json";
import en from "./locales/en.json";
import kmr from "./locales/kmr.json";

/**
 * i18n scaffolding (D12, PROJECT.md hard requirement): every visible string
 * goes through t(), four locales exist from commit one. English is the
 * source-of-truth authoring language; Sorani is the primary language at
 * release (D12) — the device-locale-detection fallback below still lands on
 * English until the release-time default is flipped, which is a product
 * decision for a later phase, not a Phase-1 engineering concern.
 */
export const SUPPORTED_LOCALES = ["en", "ckb", "kmr", "ar"] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

/** Sorani (Arabic script) and Arabic are RTL; Kurmanji and English are LTR. */
export const RTL_LOCALES: readonly SupportedLocale[] = ["ckb", "ar"];

/** Same two locales today, but a distinct concept (design-language.md §2) —
 * kept as its own list so the theme layer never has to assume RTL == Arabic
 * script if a future locale breaks that coincidence. */
export const ARABIC_SCRIPT_LOCALES: readonly SupportedLocale[] = ["ckb", "ar"];

const LANGUAGE_STORAGE_KEY = "bumelerze.language";

const resources = {
  en: { translation: en },
  ckb: { translation: ckb },
  kmr: { translation: kmr },
  ar: { translation: ar },
} as const;

function isSupportedLocale(value: string | null): value is SupportedLocale {
  return (
    value !== null &&
    (SUPPORTED_LOCALES as readonly string[]).includes(value)
  );
}

export function isRTLLocale(locale: string): boolean {
  return RTL_LOCALES.includes(locale as SupportedLocale);
}

function detectDeviceLocale(): SupportedLocale {
  const deviceLocales = Localization.getLocales();
  for (const { languageCode } of deviceLocales) {
    if (isSupportedLocale(languageCode)) {
      return languageCode;
    }
  }
  return "en";
}

/** Reads the user's previously-chosen language, if any (Settings override). */
export async function getPersistedLocale(): Promise<SupportedLocale | null> {
  try {
    const stored = await AsyncStorage.getItem(LANGUAGE_STORAGE_KEY);
    return isSupportedLocale(stored) ? stored : null;
  } catch {
    // Storage unavailable (e.g. first-run edge case) — device detection wins.
    return null;
  }
}

async function persistLocale(locale: SupportedLocale): Promise<void> {
  try {
    await AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, locale);
  } catch {
    // Non-fatal: the app still works, it just won't remember the choice.
  }
}

// Always allowed; forceRTL (below) is what actually flips layout direction.
I18nManager.allowRTL(true);

// eslint-disable-next-line import/no-named-as-default-member -- standard i18next init idiom
void i18n.use(initReactI18next).init({
  resources,
  lng: detectDeviceLocale(),
  fallbackLng: "en",
  interpolation: { escapeValue: false },
  returnNull: false,
});

export interface ChangeLocaleResult {
  /**
   * True when the reading direction flipped. Per design-language.md §5
   * ("RN/Expo implementation notes"), I18nManager.forceRTL only takes full
   * effect after a JS reload — the caller (Settings screen) must show a
   * "restarting…" state and reload, not assume the layout flips live.
   */
  requiresRestart: boolean;
}

/** Changes the active language and persists the choice. Call this from the
 * Settings language switcher — never call i18n.changeLanguage directly, or
 * the RTL-flip + persistence steps get skipped. */
export async function changeLocale(
  locale: SupportedLocale,
): Promise<ChangeLocaleResult> {
  const nextIsRTL = isRTLLocale(locale);
  const requiresRestart = nextIsRTL !== I18nManager.isRTL;

  // eslint-disable-next-line import/no-named-as-default-member -- standard i18next idiom
  await i18n.changeLanguage(locale);
  await persistLocale(locale);

  if (requiresRestart) {
    I18nManager.forceRTL(nextIsRTL);
  }

  return { requiresRestart };
}

/** Applies a persisted locale choice on cold start, before the user has
 * touched Settings this session. Safe to call every launch — it's a no-op
 * once the persisted locale and native RTL flag already agree. */
export async function applyPersistedLocaleOnLaunch(): Promise<ChangeLocaleResult> {
  const persisted = await getPersistedLocale();
  if (!persisted || persisted === i18n.language) {
    return { requiresRestart: false };
  }
  return changeLocale(persisted);
}

export default i18n;
