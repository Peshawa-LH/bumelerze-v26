import { useTranslation } from "react-i18next";

import { isRTLLocale } from "@/i18n";

/** Text in the admin tools follows the app language, not its first letter:
 * a Latin name in a Sorani card starts at the right edge like the Sorani
 * line under it (same rule as SettingsRow). Read from `i18n.language`, the
 * source every other RTL decision uses: `i18n.dir()` follows i18next's
 * resolved language, which falls back to English (left-to-right) while a
 * Sorani or Arabic file is still missing on the web (review C-3). */
export function useTextDir() {
  const { i18n } = useTranslation();
  return { writingDirection: isRTLLocale(i18n.language) ? "rtl" : "ltr" } as const;
}
