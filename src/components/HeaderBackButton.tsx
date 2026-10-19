import Ionicons from "@expo/vector-icons/Ionicons";
import { useNavigation, useRouter } from "expo-router";
import { Pressable, StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";

import { isRTLLocale } from "@/i18n";
import { useTheme } from "@/theme";

/**
 * Shared `headerLeft` back control for every pushed screen (world,
 * significant, historical, event/[id], handbook, notification-settings,
 * my-data, feedback, catalog) — each screen's own inline `<Stack.Screen
 * options={{ headerLeft: () => <HeaderBackButton /> }} />` wires this in
 * (owner: "some of the tabs dont have a back button... we need back
 * buttons").
 *
 * A custom component instead of the native-stack/react-navigation-web
 * default back control for two concrete reasons found while reproducing
 * the bug (mobile-viewport browser check against a built export):
 *  1. On web, the default back control is only present when
 *     `navigation.canGoBack()` is true — a direct deep link (e.g. a shared
 *     `/event/xyz` link, or any fresh page load) has no history and shows
 *     no control at all, leaving the user stranded. This component always
 *     renders and always has somewhere to go (see `handlePress` below).
 *  2. On web, the default control's accessible name is built from the
 *     PREVIOUS route's raw internal name when that route has no nicer
 *     title to borrow — reproduced going Home -> Significant, where it
 *     read `"(tabs), back"` (the group-route filename, not a translated
 *     label). This component's label always comes from `t("nav.back")`.
 *
 * Ionicons doesn't auto-mirror for RTL (no bundled "flip" behavior), and
 * `I18nManager.isRTL` cannot be trusted here either — its react-native-web
 * shim always reports `false` — so the chevron direction is driven
 * explicitly off `isRTLLocale(i18n.language)`, the one signal this app
 * trusts on both platforms.
 */
export function HeaderBackButton() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const navigation = useNavigation();
  const { colors } = useTheme();
  const isRTL = isRTLLocale(i18n.language);

  function handlePress() {
    if (!router.canGoBack()) {
      // Deep-link / no-history entry — Home is always a sensible fallback,
      // never leaving the back control absent or dead (brief).
      router.replace("/");
      return;
    }
    if (isSeededHomeAnchorBeneath(navigation.getState())) {
      // A cold deep link to a shared route (`/event/bml…`, `/u/name`):
      // expo-router builds the (home) stack as [index, this screen] and
      // seeds that anchor `index` with THIS screen's params, so a plain
      // `back()` landed on "/?id=bml…" or "/?username=…" (B-11). Popping to
      // the anchor through the router gives it the href's own (empty)
      // params instead — React Navigation's POP_TO replaces them. Home
      // itself reads no route params, so an anchor with any is this case.
      router.dismissTo("/");
      return;
    }
    router.back();
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("nav.back")}
      onPress={handlePress}
      hitSlop={8}
      style={styles.button}
    >
      <Ionicons
        testID="header-back-chevron"
        name={isRTL ? "chevron-forward" : "chevron-back"}
        size={26}
        color={colors.text.primary}
      />
    </Pressable>
  );
}

interface NavigationStateLike {
  index?: number;
  routes?: readonly { name: string; params?: object | undefined }[];
}

/** True when the route directly beneath the current one is the Home anchor
 * (`index`) carrying params it never asks for — the signature of an
 * expo-router deep-link seed, never of in-app navigation. */
export function isSeededHomeAnchorBeneath(state: NavigationStateLike | undefined): boolean {
  if (!state || typeof state.index !== "number" || !state.routes) {
    return false;
  }
  const beneath = state.routes[state.index - 1];
  if (!beneath || beneath.name !== "index" || !beneath.params) {
    return false;
  }
  return Object.keys(beneath.params).length > 0;
}

const styles = StyleSheet.create({
  button: {
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    marginStart: -8,
  },
});
