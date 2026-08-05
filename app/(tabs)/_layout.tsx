import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { useTranslation } from "react-i18next";
import type { ColorValue } from "react-native";

import { useTheme } from "@/theme";

type IoniconName = keyof typeof Ionicons.glyphMap;

/**
 * 5-tab bottom navigation (spec-v1.md §4 "Navigation structure"): Home is
 * the panic-time landing screen, Map/Sensor/Safety are always-reachable
 * standalone screens, Settings holds preferences including the language
 * switcher. Uses expo-router's standard `Tabs` (not the experimental
 * native-tabs API) — boring and well-documented per PROJECT.md's gotcha
 * about exotic native modules.
 */
export default function TabLayout() {
  const { t } = useTranslation();
  const { colors } = useTheme();

  function icon(name: IoniconName) {
    return function renderIcon({
      color,
      size,
    }: {
      color: ColorValue;
      size: number;
    }) {
      // Ionicons types `color` as a plain string; our tint colors always are
      // one, so this narrows a value React Native itself declares broader.
      return <Ionicons name={name} size={size} color={color as string} />;
    };
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.brand.primary,
        tabBarInactiveTintColor: colors.text.tertiary,
        tabBarStyle: {
          backgroundColor: colors.surface.raised,
          borderTopColor: colors.border.default,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: t("tabs.home"), tabBarIcon: icon("home") }}
      />
      <Tabs.Screen
        name="map"
        options={{ title: t("tabs.map"), tabBarIcon: icon("map") }}
      />
      <Tabs.Screen
        name="sensor"
        options={{ title: t("tabs.sensor"), tabBarIcon: icon("pulse") }}
      />
      <Tabs.Screen
        name="safety"
        options={{
          title: t("tabs.safety"),
          tabBarIcon: icon("shield-checkmark"),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{ title: t("tabs.settings"), tabBarIcon: icon("settings") }}
      />
    </Tabs>
  );
}
