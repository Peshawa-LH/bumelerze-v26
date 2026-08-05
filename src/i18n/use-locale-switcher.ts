import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import { changeLocale, type SupportedLocale } from "./index";
import { restartApp } from "./restart-app";

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
}

export interface UseLocaleSwitcherResult {
  isRestarting: boolean;
  selectLocale: (locale: SupportedLocale) => Promise<SelectLocaleResult>;
  currentLocale: SupportedLocale;
}

/**
 * Shared language-switch logic (Settings and onboarding's language screen
 * both need it — wave brief: "extract shared logic, don't duplicate"). Owns
 * the `changeLocale` → `restartApp` → `isRestarting` sequence in one place
 * so the RTL-restart caveat (design-language.md §5) is implemented once,
 * not twice.
 */
export function useLocaleSwitcher(
  options: UseLocaleSwitcherOptions = {},
): UseLocaleSwitcherResult {
  const { i18n } = useTranslation();
  const [isRestarting, setIsRestarting] = useState(false);
  const { onBeforeRestart } = options;

  const selectLocale = useCallback(
    async (locale: SupportedLocale): Promise<SelectLocaleResult> => {
      if (isRestarting || locale === i18n.language) {
        return { requiresRestart: false, restartFailed: false };
      }

      const { requiresRestart } = await changeLocale(locale);
      if (!requiresRestart) {
        return { requiresRestart: false, restartFailed: false };
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
    [i18n, isRestarting, onBeforeRestart],
  );

  return { isRestarting, selectLocale, currentLocale: i18n.language as SupportedLocale };
}
