import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { useTranslation } from "react-i18next";
import type { ColorValue } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { TAB_BAR_CONTENT_HEIGHT } from "@/components/Snackbar";
import { ScrollAwareTabBar } from "@/features/tab-bar/ScrollAwareTabBar";
import { useTheme } from "@/theme";

type IoniconName = keyof typeof Ionicons.glyphMap;

/**
 * 5-tab bottom navigation (spec-v1.md §4 "Navigation structure", re-cut by
 * D79 on 2026-10-08): Home is the panic-time landing screen, Map and Sensor
 * are always-reachable standalone screens, Profile is the one page for "me"
 * (the public profile plus what only I see), Settings holds preferences
 * including the language switcher and, at its top, the Safety guide. Uses expo-router's standard `Tabs` (not the experimental
 * native-tabs API) — boring and well-documented per PROJECT.md's gotcha
 * about exotic native modules.
 *
 * Each tab is a group with its own Stack (`(home)`, `(map)`, ...; see
 * `(home,map,sensor,profile,settings)/_layout.tsx`), so a screen opened from a
 * tab - an event, its hub, the catalogue, a profile - opens INSIDE that tab and
 * the bar stays. The bar slides away while a long page is scrolled down and
 * returns on scroll up (`ScrollAwareTabBar`).
 */
export default function TabLayout() {
  const { t } = useTranslation();
  const { colors, typography } = useTheme();
  const insets = useSafeAreaInsets();
  const labelFontSize = typography.labelCaption.fontFamily
    ? 11
    : typography.labelCaption.fontSize;

  function icon(name: IoniconName, outlineName?: IoniconName) {
    return function renderIcon({
      color,
      size,
      focused,
    }: {
      color: ColorValue;
      size: number;
      focused: boolean;
    }) {
      // Ionicons types `color` as a plain string; our tint colors always are
      // one, so this narrows a value React Native itself declares broader.
      return (
        <Ionicons
          name={outlineName && !focused ? outlineName : name}
          size={size}
          color={color as string}
        />
      );
    };
  }

  return (
    <Tabs
      tabBar={(props) => <ScrollAwareTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.brand.primary,
        tabBarInactiveTintColor: colors.text.tertiary,
        tabBarStyle: {
          backgroundColor: colors.surface.raised,
          borderTopColor: colors.border.default,
          // Explicit height: React Navigation's default is a fixed 48 px,
          // which the below-icon stack (28 px icon + a label whose line box
          // is ~14 px + 10 px padding) overflows, so the bottom of every
          // label was clipped — worst for Sorani's deep descenders (owner,
          // 2026-09-27, seen on PC and phone). 58 px fits the stack; the
          // safe-area inset is added on top so the bar clears a home
          // indicator without squeezing the labels.
          height: TAB_BAR_CONTENT_HEIGHT + insets.bottom,
          paddingBottom: insets.bottom,
          paddingTop: 4,
        },
        // Always below the icon. React Navigation's default switches to
        // beside-icon in a landscape-shaped viewport and gives the label a
        // fixed sliver next to the icon — English "Home" survives, Sorani
        // "ڕێکخستنەکان" was clipped to its first letter (seen live,
        // 2026-09-27). Five short labels belong under their icons anyway.
        tabBarLabelPosition: "below-icon",
        // The label carries the theme's face explicitly: the tab bar sets
        // its own inline system font, which no document-level rule can
        // reach, so Vazirmatn (Arabic-script locales) has to be handed in.
        // Five tabs on a 320 px CSS viewport (the iPhone SE class) leave
        // 64 px per item. React Navigation pads each item 5 px a side; the
        // longest Sorani label, ڕێکخستنەکان, is 64 px at 12 px and was
        // still clipping there after the below-icon fix (measured live).
        // 2 px padding and 11 px for Arabic-script labels make it fit;
        // phone widths from 375 px never needed either.
        tabBarItemStyle: { paddingHorizontal: 2 },
        tabBarLabelStyle: {
          fontSize: labelFontSize,
          // A real line box, so descenders are drawn rather than clipped.
          lineHeight: Math.round(labelFontSize * 1.35),
          fontWeight: typography.labelCaption.fontWeight,
          ...(typography.labelCaption.fontFamily
            ? { fontFamily: typography.labelCaption.fontFamily }
            : {}),
        },
      }}
    >
      <Tabs.Screen
        name="(home)"
        options={{ title: t("tabs.home"), tabBarIcon: icon("home") }}
      />
      <Tabs.Screen
        name="(map)"
        options={{ title: t("tabs.map"), tabBarIcon: icon("map") }}
      />
      <Tabs.Screen
        name="(sensor)"
        options={{ title: t("tabs.sensor"), tabBarIcon: icon("pulse") }}
      />
      <Tabs.Screen
        name="(profile)"
        options={{
          title: t("tabs.profile"),
          tabBarIcon: icon("person-circle", "person-circle-outline"),
        }}
      />
      <Tabs.Screen
        name="(settings)"
        options={{ title: t("tabs.settings"), tabBarIcon: icon("settings") }}
      />
    </Tabs>
  );
}
