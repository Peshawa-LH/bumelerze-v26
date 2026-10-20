import Ionicons from "@expo/vector-icons/Ionicons";
import { Tabs } from "expo-router";
import { useTranslation } from "react-i18next";
import { Platform, Text, type ColorValue, type TextStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { TAB_BAR_CONTENT_HEIGHT } from "@/components/Snackbar";
import { ScrollAwareTabBar } from "@/features/tab-bar/ScrollAwareTabBar";
import { tabBarButtonOptions } from "@/features/tab-bar/web-tab-button";
import { ARABIC_SCRIPT_LOCALES, type SupportedLocale } from "@/i18n";
import { useTheme } from "@/theme";

type IoniconName = keyof typeof Ionicons.glyphMap;

/**
 * 5-tab bottom navigation (the v1 spec §4 "Navigation structure", re-cut by
 * D79 on 2026-10-08): Home is the panic-time landing screen, Map and Sensor
 * are always-reachable standalone screens, Profile is the one page for "me"
 * (the public profile plus what only I see), Settings holds preferences
 * including the language switcher and, at its top, the Safety guide. Uses expo-router's standard `Tabs` (not the experimental
 * native-tabs API) — boring and well-documented per the project gotcha
 * about exotic native modules.
 *
 * Each tab is a group with its own Stack (`(home)`, `(map)`, ...; see
 * `(home,map,sensor,profile,settings)/_layout.tsx`), so a screen opened from a
 * tab - an event, its hub, the catalogue, a profile - opens INSIDE that tab and
 * the bar stays. The bar slides away while a long page is scrolled down and
 * returns on scroll up (`ScrollAwareTabBar`).
 */
export default function TabLayout() {
  const { t, i18n } = useTranslation();
  const { colors, typography } = useTheme();
  const insets = useSafeAreaInsets();
  // From the language, not from the font family: on iOS/Android the family
  // is named only once Vazirmatn is registered (`useTheme`).
  const isArabicScript = ARABIC_SCRIPT_LOCALES.includes(i18n.language as SupportedLocale);
  const labelFontSize = isArabicScript ? 11 : typography.labelCaption.fontSize;
  const labelStyle: TextStyle = {
    fontSize: labelFontSize,
    // A real line box, so descenders are drawn rather than clipped.
    lineHeight: Math.round(labelFontSize * 1.35),
    fontWeight: typography.labelCaption.fontWeight,
    ...(typography.labelCaption.fontFamily
      ? { fontFamily: typography.labelCaption.fontFamily }
      : {}),
  };

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
        // Web: a press always counts, however long it is held
        // (features/tab-bar/web-tab-button.tsx). iOS/Android: the default.
        ...tabBarButtonOptions,
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
        tabBarLabelStyle: labelStyle,
        ...(Platform.OS === "web" ? {} : nativeTabBarLabel(labelStyle)),
      }}
    >
      <Tabs.Screen
        name="(home)"
        options={{
          ...nativeA11yLabel(t("tabs.home")),
          title: t("tabs.home"),
          tabBarIcon: icon("home"),
        }}
      />
      <Tabs.Screen
        name="(map)"
        options={{
          ...nativeA11yLabel(t("tabs.map")),
          title: t("tabs.map"),
          tabBarIcon: icon("map"),
        }}
      />
      <Tabs.Screen
        name="(sensor)"
        options={{
          ...nativeA11yLabel(t("tabs.sensor")),
          title: t("tabs.sensor"),
          tabBarIcon: icon("pulse"),
        }}
      />
      <Tabs.Screen
        name="(profile)"
        options={{
          ...nativeA11yLabel(t("tabs.profile")),
          title: t("tabs.profile"),
          tabBarIcon: icon("person-circle", "person-circle-outline"),
        }}
      />
      <Tabs.Screen
        name="(settings)"
        options={{
          ...nativeA11yLabel(t("tabs.settings")),
          title: t("tabs.settings"),
          tabBarIcon: icon("settings"),
        }}
      />
    </Tabs>
  );
}

/**
 * iOS/Android: the tab label drawn by the app instead of React Navigation's,
 * so it can shrink to fit. React Navigation's label is one line that iOS
 * never scales; a label wider than its item (an iPhone SE gives each of the
 * five 64 pt, and Vazirmatn's ڕێکخستنەکان needs about 59 at 11 pt) is cut
 * with "…". This one shrinks to 80 % first. Same one-line, centred label
 * otherwise. The web keeps React Navigation's label, measured and tuned at
 * 320 px.
 */
function nativeTabBarLabel(style: TextStyle) {
  // With a drawn label React Navigation no longer builds the tab's spoken
  // name, and VoiceOver read the icon glyphs too (", , Home"). Each tab
  // sets `tabBarAccessibilityLabel` to its title instead (`nativeA11yLabel`).
  return {
    tabBarLabel: ({ color, children }: { color: ColorValue; children: string }) => (
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.8}
        // Justification: the bar is a fixed 58 pt (icon + one 15 pt line
        // fill it), so a larger label would be cut at the bottom. As in
        // UIKit's own tab bars, and as React Navigation's label did on iOS,
        // the text-size setting reaches the label through the button's
        // long-press Large Content Viewer instead.
        maxFontSizeMultiplier={Platform.OS === "ios" ? 1 : null}
        style={[{ textAlign: "center", backgroundColor: "transparent", color }, style]}
      >
        {children}
      </Text>
    ),
  };
}

/** iOS/Android: the tab's spoken name is its title (see `nativeTabBarLabel`).
 * The web keeps React Navigation's own. */
function nativeA11yLabel(title: string) {
  return Platform.OS === "web" ? {} : { tabBarAccessibilityLabel: title };
}
