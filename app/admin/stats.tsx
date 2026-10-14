import { Stack } from "expo-router";
import { View } from "react-native";
import { useTranslation } from "react-i18next";

import { HeaderBackButton } from "@/components/HeaderBackButton";
import { StatsContent } from "@/features/admin";
import { useTheme } from "@/theme";

/** Admin > Statistics: counts only (`stats.read`, migration 0066). */
export default function AdminStatsScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: colors.surface.base }}>
      <Stack.Screen
        options={{
          title: t("admin.tools.stats"),
          headerShown: true,
          headerLeft: () => <HeaderBackButton />,
        }}
      />
      <StatsContent />
    </View>
  );
}
