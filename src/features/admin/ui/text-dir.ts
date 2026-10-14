import { useTranslation } from "react-i18next";

/** Text in the admin tools follows the app language, not its first letter:
 * a Latin name in a Sorani card starts at the right edge like the Sorani
 * line under it (same rule as SettingsRow). */
export function useTextDir() {
  const { i18n } = useTranslation();
  return { writingDirection: i18n.dir() } as const;
}
