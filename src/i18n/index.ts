import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Localization from "expo-localization";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { I18nManager, Platform } from "react-native";

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

/**
 * Web-only, synchronous read of the persisted locale, straight off
 * `window.localStorage` rather than through `AsyncStorage.getItem` (which
 * is Promise-based even though the web implementation is a thin sync
 * wrapper — see `@react-native-async-storage/async-storage`'s web
 * `AsyncStorage.js`: `getItem` calls `window.localStorage.getItem(key)`
 * with the RAW key, no prefix, and stores the raw string value, not a
 * JSON-wrapped one). We need the answer BEFORE the first render (see the
 * module-load block below), so the async API can't be used here.
 */
function readPersistedLocaleWebSync(): SupportedLocale | null {
  if (Platform.OS !== "web") {
    return null;
  }
  try {
    if (typeof window === "undefined" || !window.localStorage) {
      return null;
    }
    const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return isSupportedLocale(stored) ? stored : null;
  } catch {
    // Storage unavailable (e.g. privacy mode) — fall through to detection.
    return null;
  }
}

/** Web-only: mirrors reading direction onto the DOM so CSS/native-web
 * layout agrees with `I18nManager.isRTL` without waiting for a reload.
 * No-ops on native and during SSR/static-export's node render pass. */
function applyDocumentDirWeb(isRTL: boolean): void {
  if (Platform.OS !== "web") {
    return;
  }
  try {
    if (typeof document === "undefined" || !document.documentElement) {
      return;
    }
    document.documentElement.setAttribute("dir", isRTL ? "rtl" : "ltr");
  } catch {
    // Best-effort only — never let this crash boot or a language switch.
  }
}

// Always allowed; forceRTL (below) is what actually flips layout direction.
I18nManager.allowRTL(true);

// Web has no native persistence for `I18nManager.forceRTL` (it's in-memory
// only and never survives a reload — unlike native, where the flag is
// written to a native prefs file and is already correct on the NEXT
// process launch). Left alone, `applyPersistedLocaleOnLaunch()` would see
// `I18nManager.isRTL` reset to `false` on every web boot, ask for a
// restart, reload, and see the same mismatch again — an infinite reload
// loop (this was the P0 bug). Fix: on web only, read the persisted locale
// synchronously BEFORE `i18n.init`, apply forceRTL + the DOM `dir`
// attribute right here, and seed i18next's initial language with it, so
// direction and first-render language are already correct — the launch
// effect below then finds nothing to do. Native takes none of this path
// (`readPersistedLocaleWebSync` is a no-op there), so native boot behavior
// is unchanged.
const webPersistedLocale = readPersistedLocaleWebSync();
const initialLocale: SupportedLocale = webPersistedLocale ?? detectDeviceLocale();

if (Platform.OS === "web") {
  const initialIsRTL = isRTLLocale(initialLocale);
  I18nManager.forceRTL(initialIsRTL);
  applyDocumentDirWeb(initialIsRTL);
}

// eslint-disable-next-line import/no-named-as-default-member -- standard i18next init idiom
void i18n.use(initReactI18next).init({
  resources,
  lng: initialLocale,
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
    // Keep the DOM in sync immediately — the actual remount still happens
    // via the caller's `restartApp()` (a single user-triggered reload is
    // fine; see module-load comment above for why the LAUNCH path must
    // never trigger one).
    applyDocumentDirWeb(nextIsRTL);
  }

  return { requiresRestart };
}

/** Applies a persisted locale choice on cold start, before the user has
 * touched Settings this session. Safe to call every launch — it's a no-op
 * once the persisted locale and native RTL flag already agree.
 *
 * On web this must NEVER resolve `requiresRestart: true`: the module-load
 * block above already reads the persisted locale synchronously and applies
 * forceRTL + the DOM `dir` attribute + the correct initial i18next language
 * before this ever runs, so by the time this effect fires there is nothing
 * left to reconcile. `I18nManager.isRTL` on web is in-memory-only and never
 * survives a reload, so if this function ever asked for one here, every
 * boot would ask for another — the P0 infinite-reload bug. The guard below
 * is belt-and-suspenders on top of that already-true invariant. Native is
 * untouched: its `I18nManager.forceRTL` flag *does* persist natively, so
 * this same early-return guard was already sufficient there. */
export async function applyPersistedLocaleOnLaunch(): Promise<ChangeLocaleResult> {
  const persisted = await getPersistedLocale();
  if (!persisted || persisted === i18n.language) {
    return { requiresRestart: false };
  }
  const result = await changeLocale(persisted);
  if (Platform.OS === "web") {
    return { requiresRestart: false };
  }
  return result;
}

export default i18n;
