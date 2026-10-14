import { useNavigationContainerRef, usePathname } from "expo-router";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";

/** The brand, as the tab reads it on its own (Home) and after every title. */
export const APP_TITLE = "Bumelerze";

/** Tab roots have no header title of their own; the tab's name stands in. */
const TAB_ROOT_TITLE_KEYS: Readonly<Record<string, string>> = {
  "/map": "tabs.map",
  "/sensor": "tabs.sensor",
  "/profile": "tabs.profile",
  "/settings": "tabs.settings",
};

/**
 * What the browser tab should say: "Bumelerze" on Home, else
 * "<screen title> · Bumelerze" from the focused screen's own header title
 * (the `title` every pushed screen sets in its `<Stack.Screen options>`), or
 * the tab's name on a tab root. Without any title: the brand alone.
 */
export function documentTitleFor(
  screenTitle: string | null,
  pathname: string,
  t: (key: string, values?: Record<string, string>) => string,
): string {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/") {
    return APP_TITLE;
  }
  const tabKey = TAB_ROOT_TITLE_KEYS[path];
  const title = screenTitle ?? (tabKey ? t(tabKey) : null);
  return title ? t("nav.documentTitle", { title }) : APP_TITLE;
}

/**
 * Keeps `document.title` in step with the screen (review B-23: every screen
 * read "Bumelerze", so history, the tab switcher and bookmarks could not tell
 * them apart). Expo Router turns React Navigation's own document title off,
 * so this reads the focused screen's `title` option through the navigation
 * container the same way, and re-applies on every options change, route
 * change and language change. Call once, in the root layout.
 */
export function useDocumentTitle(): void {
  const navigation = useNavigationContainerRef();
  const pathname = usePathname();
  const { t, i18n } = useTranslation();

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    const apply = () => {
      const options = (navigation.isReady() ? navigation.getCurrentOptions() : undefined) as
        | { title?: unknown }
        | undefined;
      const title = options?.title;
      document.title = documentTitleFor(
        typeof title === "string" && title.trim() !== "" ? title : null,
        pathname,
        (key, values) => t(key, values ?? {}),
      );
    };
    apply();
    // Screens set their title after mounting (inline `<Stack.Screen options>`),
    // which the container reports as an options change.
    const unsubscribe = navigation.addListener("options", apply);
    return unsubscribe;
  }, [navigation, pathname, t, i18n.language]);
}
