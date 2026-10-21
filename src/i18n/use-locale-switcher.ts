import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { I18nManager, Platform } from "react-native";

import { changeLocale, isRTLLocale, type SupportedLocale } from "./index";
import { restartApp } from "./restart-app";
import { forgetOpenedLink, rememberRestartResume } from "./restart-resume";

export interface SelectLocaleResult {
  requiresRestart: boolean;
  /** True only when a restart was required and the reload itself failed to
   * fire (e.g. no Updates runtime available) — the caller should tell the
   * user to relaunch manually (mirrors restart-app.ts's own doc comment). */
  restartFailed: boolean;
}

export interface UseLocaleSwitcherOptions {
  /** Runs synchronously right before a required reload — lets a caller
   * persist state that must survive the JS remount (e.g. onboarding's
   * resume step, see src/features/onboarding/store.ts) before the app
   * tears down. Never called when no restart is needed. */
  onBeforeRestart?: () => void;
  /** The app path to come back to after the restart (the screen the switch
   * was made on), instead of Home or the last link the app opened (iOS;
   * `restart-resume.ts`). */
  resumePath?: string;
}

export interface UseLocaleSwitcherResult {
  isRestarting: boolean;
  selectLocale: (locale: SupportedLocale) => Promise<SelectLocaleResult>;
  currentLocale: SupportedLocale;
}

/**
 * Shared language-switch logic (Settings and onboarding's language screen
 * both need it — brief: "extract shared logic, don't duplicate"). Owns
 * the `changeLocale` → `restartApp` → `isRestarting` sequence in one place
 * so the RTL-restart caveat (the design language §5) is implemented once,
 * not twice.
 */
export function useLocaleSwitcher(
  options: UseLocaleSwitcherOptions = {},
): UseLocaleSwitcherResult {
  const { i18n } = useTranslation();
  const [isRestarting, setIsRestarting] = useState(false);
  const { onBeforeRestart, resumePath } = options;

  const selectLocale = useCallback(
    async (locale: SupportedLocale): Promise<SelectLocaleResult> => {
      // iOS/Android: picking the language already shown still goes through
      // when the layout runs the wrong way for it (a Sorani phone whose app
      // started left to right), so the pick itself repairs the direction.
      const directionIsWrong =
        Platform.OS !== "web" && isRTLLocale(locale) !== I18nManager.isRTL;
      if (isRestarting || (locale === i18n.language && !directionIsWrong)) {
        return { requiresRestart: false, restartFailed: false };
      }

      const { requiresRestart } = await changeLocale(locale);
      if (!requiresRestart) {
        return { requiresRestart: false, restartFailed: false };
      }

      // The restart must not open the last link again, and comes back here.
      forgetOpenedLink();
      if (resumePath !== undefined) {
        rememberRestartResume(resumePath);
      }
      onBeforeRestart?.();
      setIsRestarting(true);
      try {
        await restartApp();
        return { requiresRestart: true, restartFailed: false };
      } catch {
        setIsRestarting(false);
        return { requiresRestart: true, restartFailed: true };
      }
    },
    [i18n, isRestarting, onBeforeRestart, resumePath],
  );

  return { isRestarting, selectLocale, currentLocale: i18n.language as SupportedLocale };
}
