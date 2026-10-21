import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Localization from "expo-localization";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { I18nManager, Platform } from "react-native";

import { localizeDigits } from "@/lib/format-numbers";
import {
  appleLanguagePickedInSystemSettings,
  currentAppleLanguage,
  setAppleLanguage,
} from "./apple-languages";
import { appLanguageCode } from "./language-codes";
import { initialTranslations, loadTranslation } from "./locale-resources";

/**
 * i18n scaffolding (D12, a hard project requirement): every visible string
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

/** Same two locales today, but a distinct concept (the design language §2) —
 * kept as its own list so the theme layer never has to assume RTL == Arabic
 * script if a future locale breaks that coincidence. */
export const ARABIC_SCRIPT_LOCALES: readonly SupportedLocale[] = ["ckb", "ar"];

const LANGUAGE_STORAGE_KEY = "bumelerze.language";

// iOS/Android: all four languages. Web: English only at first; the others
// arrive through `ensureLocaleLoaded` (locale-resources.web.ts).
const resources = Object.fromEntries(
  Object.entries(initialTranslations()).map(([locale, translation]) => [
    locale,
    { translation },
  ]),
);

function isSupportedLocale(value: string | null): value is SupportedLocale {
  return (
    value !== null &&
    (SUPPORTED_LOCALES as readonly string[]).includes(value)
  );
}

export function isRTLLocale(locale: string): boolean {
  return RTL_LOCALES.includes(locale as SupportedLocale);
}

export type TextDirection = "ltr" | "rtl";

/** The reading direction of the app language — never `I18nManager.isRTL`,
 * which react-native-web always reports as false. */
export function textDirectionFor(locale: string): TextDirection {
  return isRTLLocale(locale) ? "rtl" : "ltr";
}

/**
 * Props that pin a `Text` or `TextInput` paragraph to the app language's
 * direction on the web. react-native-web gives every root `Text` and
 * `TextInput` `dir="auto"`, and the browser then resolves the direction
 * from the FIRST strong character: a Sorani line that happens to start with
 * a Latin token ("Ss ١.٠٩g", "MP.KIR1 · …", "@username") or with digits
 * only (a date, an id) lays out as an LTR paragraph, sits at the left edge
 * under right-aligned labels and puts its last word at the reading start
 * (A-7, B-3, B-6, B-7, B-8). `dir="auto"` also overrides the CSS
 * `direction` that `style.writingDirection` sets, so the attribute itself
 * has to change. Spread it on the element; it is `{}` on native, where
 * `writingDirection` (see `directionStyle`) is honoured directly.
 */
export function directionProps(locale: string): { dir?: TextDirection } {
  return Platform.OS === "web" ? { dir: textDirectionFor(locale) } : {};
}

/**
 * The `textAlign` value that puts a paragraph on the given PHYSICAL edge of
 * the screen, on every platform.
 *
 * iOS and Android swap `"left"` and `"right"` while the native layout runs
 * right to left (`RCTAttributedTextUtils.mm`, Android `TextAttributeProps`):
 * there `"left"` means the reading start. The native layout direction is
 * pinned to the app language (`pinNativeLayoutDirection`), so under Sorani
 * and Arabic a bare `textAlign: "right"` landed on the LEFT on iOS while the
 * web put it on the right (item 50 of the iOS parity inventory). The web
 * never swaps (`I18nManager.isRTL` is always false in react-native-web), so
 * it gets the side as asked.
 */
export function physicalTextAlign(side: "left" | "right"): "left" | "right" {
  if (Platform.OS === "web" || !I18nManager.isRTL) {
    return side;
  }
  return side === "left" ? "right" : "left";
}

/** The matching style fragment: the paragraph direction (native, and CSS
 * on web) plus reading-start alignment. RN's `textAlign` has no `start`, so
 * the logical start is expressed as the physical side it maps to
 * (`physicalTextAlign`: on iOS/Android that is "left" under a right-to-left
 * layout as well). */
export function directionStyle(locale: string): {
  writingDirection: TextDirection;
  textAlign: "left" | "right";
} {
  const direction = textDirectionFor(locale);
  return {
    writingDirection: direction,
    textAlign: physicalTextAlign(direction === "rtl" ? "right" : "left"),
  };
}

/**
 * For a value that always reads left to right whatever the app language —
 * an email address, a username, a code or id, a URL — and sits on the
 * physical LEFT edge, as the web shows it under Sorani and Arabic too. A
 * bare `textAlign: "left"` put these on the right on iOS under a
 * right-to-left layout. On the web, pair it with `dir="ltr"` where
 * react-native-web's `dir="auto"` would pick the wrong direction.
 */
export function ltrValueStyle(): { writingDirection: "ltr"; textAlign: "left" | "right" } {
  return { writingDirection: "ltr", textAlign: physicalTextAlign("left") };
}

/**
 * The `textAlign` that puts a TEXT BOX's text (`TextInput`: its placeholder
 * and what is typed) on the given physical side, on every platform.
 *
 * Not `physicalTextAlign`: that one is for paragraphs (`Text`), which iOS
 * and Android draw through React Native's text layout and swap under a
 * right-to-left layout. A text box's alignment never goes through it. iOS
 * puts it straight into the box's text attributes, Android maps it to the
 * absolute `Gravity.LEFT`/`Gravity.RIGHT` (`ReactTextInputManager`), and the
 * web never swaps. A box given the paragraph helpers' answer therefore sat on
 * the wrong side in Sorani and Arabic on iOS: the handbook's coordinate and
 * spectrum boxes on the left, the sign-in email on the right (parity
 * re-check N1, 2026-10-21). On the web both helpers give the same value.
 */
export function physicalInputAlign(side: "left" | "right"): "left" | "right" {
  return side;
}

/** `directionStyle` for a text box: the language's direction, with the
 * text at its reading start (right for Sorani and Arabic, left otherwise). */
export function inputDirectionStyle(locale: string): {
  writingDirection: TextDirection;
  textAlign: "left" | "right";
} {
  const direction = textDirectionFor(locale);
  return {
    writingDirection: direction,
    textAlign: physicalInputAlign(direction === "rtl" ? "right" : "left"),
  };
}

/** `ltrValueStyle` for a text box: an email address, username, code or URL
 * typed left to right on the physical left, in every language. */
export function ltrValueInputStyle(): {
  writingDirection: "ltr";
  textAlign: "left" | "right";
} {
  return { writingDirection: "ltr", textAlign: physicalInputAlign("left") };
}

function detectDeviceLocale(): SupportedLocale {
  const deviceLocales = Localization.getLocales();
  for (const { languageCode } of deviceLocales) {
    // A phone set to "ku" (the generic Kurdish code iOS uses) gets Kurmanji.
    const code = appLanguageCode(languageCode);
    if (isSupportedLocale(code)) {
      return code;
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
    applyDocumentFontWeb();
  } catch {
    // Best-effort only — never let this crash boot or a language switch.
  }
}

/** Web-only: `<html lang>` follows the app language on every change, not
 * only when the reading direction flips (B-9). The static `index.html` says
 * `lang="en"`, so without this a Sorani, Kurmanji or Arabic page was read
 * out and hyphenated as English by screen readers and browsers. The four
 * codes are valid BCP-47 primary subtags as they stand (`ckb`/`kmr` are ISO
 * 639-3). No-ops on native and during the static-export render pass. */
function applyDocumentLangWeb(locale: SupportedLocale): void {
  if (Platform.OS !== "web") {
    return;
  }
  try {
    if (typeof document === "undefined" || !document.documentElement) {
      return;
    }
    document.documentElement.setAttribute("lang", locale);
  } catch {
    // Best-effort only — never let this crash boot or a language switch.
  }
}

const WEB_FONT_STYLE_ID = "bml-arabic-script-font";

/** Web-only: every text node under an RTL document renders in Vazirmatn
 * (see `ARABIC_SCRIPT_FONT` in `src/theme/typography.ts` for why). One
 * stylesheet, injected once; `expo-font` registers the same faces as
 * `@font-face`, and react-native-web sets no font-family of its own, so a
 * document rule reaches every `Text`. */
function applyDocumentFontWeb(): void {
  if (typeof document === "undefined" || document.getElementById(WEB_FONT_STYLE_ID)) {
    return;
  }
  const style = document.createElement("style");
  style.id = WEB_FONT_STYLE_ID;
  style.textContent =
    'html[dir="rtl"] body, html[dir="rtl"] body * { ' +
    // NO `!important`. It was added as a net for React Navigation's inline
    // system font, and it also overrode `@expo/vector-icons`' inline
    // `font-family: ionicons` on every glyph span — under Sorani and Arabic
    // every icon, the header back chevron and every icon-only button
    // rendered blank (owner, 2026-09-27). Inline styles must win: icons keep
    // their font, and navigation text gets Vazirmatn through explicit
    // `tabBarLabelStyle`/`headerTitleStyle` props instead.
    'font-family: "Vazirmatn-Regular", "Vazirmatn", "Noto Naskh Arabic", system-ui, sans-serif; }';
  document.head.appendChild(style);
}

// Web: always allowed; forceRTL (below) is what actually flips layout
// direction. iOS and Android keep BOTH native flags pinned to the app
// language instead (`pinNativeLayoutDirection`): an unconditional
// allowRTL(true) on every start would let a Sorani or Arabic PHONE language
// turn the layout right to left again on the next launch after the user
// picked English or Kurmanji in the app.
if (Platform.OS === "web") {
  I18nManager.allowRTL(true);
}

/**
 * iOS/Android: makes every later JS start lay out in `isRTL`'s direction,
 * whatever the phone language is. React Native keeps both flags natively
 * (iOS user defaults, Android shared preferences) and reads them once, when
 * the app's JS starts, so the change shows after a restart. With both off,
 * the layout is left to right even on an Arabic-script phone; with both on,
 * right to left even on an English one.
 */
function pinNativeLayoutDirection(isRTL: boolean): void {
  I18nManager.allowRTL(isRTL);
  I18nManager.forceRTL(isRTL);
}

const LAUNCH_DIRECTION_RESTART_KEY = "bumelerze.launchDirectionRestartAt";
const LAUNCH_DIRECTION_RESTART_WINDOW_MS = 60_000;

/**
 * iOS/Android: a launch may restart the app to put the layout direction
 * right, but only once a minute. If the app comes back up still in the
 * wrong direction (something reset the native flag before the JS started),
 * it carries on as it is rather than restarting forever: the web's reload
 * loop (the P0 bug described below) must never happen on a phone either.
 */
async function allowLaunchDirectionRestart(): Promise<ChangeLocaleResult> {
  try {
    const now = Date.now();
    const last = Number(await AsyncStorage.getItem(LAUNCH_DIRECTION_RESTART_KEY));
    if (
      Number.isFinite(last) &&
      last > 0 &&
      now - last < LAUNCH_DIRECTION_RESTART_WINDOW_MS
    ) {
      return { requiresRestart: false };
    }
    await AsyncStorage.setItem(LAUNCH_DIRECTION_RESTART_KEY, String(now));
  } catch {
    // Without a record a loop cannot be ruled out: no restart.
    return { requiresRestart: false };
  }
  return { requiresRestart: true };
}

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
  applyDocumentLangWeb(initialLocale);
}

// eslint-disable-next-line import/no-named-as-default-member -- standard i18next init idiom
void i18n.use(initReactI18next).init({
  resources,
  lng: initialLocale,
  fallbackLng: "en",
  interpolation: { escapeValue: false },
  returnNull: false,
});

/**
 * `{{value, digits}}` in a locale string renders the interpolated number in
 * the locale's own digits (`localizeDigits`: Eastern Arabic-Indic for ckb
 * and ar, untouched elsewhere). For the many templates whose number is also
 * i18next's plural `count` — "{{count, digits}} stations" — this is the only
 * way to localise the glyphs without a second placeholder, and it lets a
 * translator fix a Western-digit string ("وەشانی 26.1.0") in the catalog
 * alone. Numbers that need a bidi isolate as well (Latin units, mixed
 * chunks) keep going through `isolateNumeric` in code.
 */
i18n.services.formatter?.add("digits", (value: unknown, lng: string | undefined) =>
  localizeDigits(String(value ?? ""), lng ?? "en"),
);

/**
 * Makes sure the translation for `locale` is in i18next. Immediate on
 * iOS/Android (everything is bundled); on the web it downloads that one
 * language file the first time. Never rejects: offline without the file,
 * the app stays readable in English (the fallback).
 */
export async function ensureLocaleLoaded(locale: SupportedLocale): Promise<void> {
  if (i18n.hasResourceBundle(locale, "translation")) {
    return;
  }
  try {
    const translation = await loadTranslation(locale);
    i18n.addResourceBundle(locale, "translation", translation, true, true);
    // i18next works out `resolvedLanguage` (which `i18n.dir()` reads) only
    // when the language is set: it fell back to English while the file was
    // missing, so Sorani and Arabic read as left-to-right. Set it again.
    if (i18n.language === locale) {
      // eslint-disable-next-line import/no-named-as-default-member -- standard i18next idiom
      await i18n.changeLanguage(locale);
    }
  } catch {
    // Offline and never downloaded: English shows instead.
  }
}

/** Resolves once the starting language can be shown (at once on iOS/Android). */
export const initialLocaleReady: Promise<void> = ensureLocaleLoaded(initialLocale);

let initialLocaleIsReady = false;
void initialLocaleReady.then(() => {
  initialLocaleIsReady = true;
});

/** True once `initialLocaleReady` has resolved (synchronous check for the
 * root layout's first render). */
export function isInitialLocaleReady(): boolean {
  return initialLocaleIsReady;
}

export interface ChangeLocaleResult {
  /**
   * True when the reading direction flipped. Per the design language §5
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

  await ensureLocaleLoaded(locale);
  // eslint-disable-next-line import/no-named-as-default-member -- standard i18next idiom
  await i18n.changeLanguage(locale);
  await persistLocale(locale);
  // Every change, not only a direction flip: en -> kmr keeps `dir="ltr"`
  // but must still read as Kurmanji to assistive technology (B-9).
  applyDocumentLangWeb(locale);
  // iOS/Android: every change pins the direction to the new language, so a
  // later launch keeps it whatever the phone language is. iOS also takes the
  // language as the app's own system language (natural text alignment,
  // system texts; `apple-languages.ios.ts`) from the next launch on.
  if (Platform.OS !== "web") {
    pinNativeLayoutDirection(nextIsRTL);
    setAppleLanguage(locale);
  }

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
 * is belt-and-suspenders on top of that already-true invariant.
 *
 * iOS/Android persist `I18nManager.forceRTL` natively. There the launch also
 * checks the direction when the language itself is already right: a first
 * launch on a Sorani or Arabic phone, or a phone whose language changed
 * since the direction was pinned. A mismatch pins the direction and asks for
 * one restart; `allowLaunchDirectionRestart` keeps that from ever looping. */
export async function applyPersistedLocaleOnLaunch(): Promise<ChangeLocaleResult> {
  // iOS: a language picked for the app in the iOS Settings app (which
  // restarts the app) counts as the person's choice, like a pick in the
  // app's own Settings; otherwise the app would put its old one back.
  const pickedInSystemSettings =
    Platform.OS === "ios" ? appleLanguagePickedInSystemSettings() : null;
  if (isSupportedLocale(pickedInSystemSettings)) {
    const result = await changeLocale(pickedInSystemSettings);
    return result.requiresRestart ? allowLaunchDirectionRestart() : result;
  }
  const persisted = await getPersistedLocale();
  if (!persisted || persisted === i18n.language) {
    if (Platform.OS === "web") {
      return { requiresRestart: false };
    }
    // A chosen language that iOS does not know as the app's language yet
    // (chosen before this was written, or the write was lost): from the
    // next launch on.
    if (persisted && currentAppleLanguage() !== persisted) {
      setAppleLanguage(persisted);
    }
    const wantsRTL = isRTLLocale(i18n.language);
    if (wantsRTL === I18nManager.isRTL) {
      return { requiresRestart: false };
    }
    pinNativeLayoutDirection(wantsRTL);
    return allowLaunchDirectionRestart();
  }
  const result = await changeLocale(persisted);
  if (Platform.OS === "web") {
    return { requiresRestart: false };
  }
  return result.requiresRestart ? allowLaunchDirectionRestart() : result;
}

export default i18n;
