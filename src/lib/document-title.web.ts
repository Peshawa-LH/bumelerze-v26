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
 * After a navigation, when to look at the focused screen's title again (ms).
 * A screen sets its title from its own effect once it has mounted (inline
 * `<Stack.Screen options>`), some only when their data has arrived (a public
 * profile's @name), and Expo Router 58's navigation container no longer
 * reports option changes (its `options` event is gone): it reports only
 * navigation (`state`).
 */
export const TITLE_SETTLE_CHECKS_MS: readonly number[] = [50, 250, 1000, 3000];

/**
 * Keeps `document.title` in step with the screen (review B-23: every screen
 * read "Bumelerze", so history, the tab switcher and bookmarks could not tell
 * them apart). Expo Router turns React Navigation's own document title off,
 * so this reads the focused screen's `title` option through the navigation
 * container, and re-applies on every navigation, route change and language
 * change, then a few more times while the new screen settles
 * (`TITLE_SETTLE_CHECKS_MS`). Call once, in the root layout.
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
    let checks: ReturnType<typeof setTimeout>[] = [];
    const settle = () => {
      checks.forEach(clearTimeout);
      apply();
      checks = TITLE_SETTLE_CHECKS_MS.map((ms) => setTimeout(apply, ms));
    };
    settle();
    const unsubscribe = navigation.addListener("state", settle);
    return () => {
      unsubscribe();
      checks.forEach(clearTimeout);
    };
  }, [navigation, pathname, t, i18n.language]);
}
