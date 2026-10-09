import { Stack } from "expo-router";
import { View } from "react-native";
import { useTranslation } from "react-i18next";

import { HeaderBackButton } from "@/components/HeaderBackButton";
import { AlertsAdminContent } from "@/features/alerts";
import { useTheme } from "@/theme";

/** Admin > Alerts (migration 0062): who receives earthquake alerts, the
 * testers, recent sending runs and a test alert. Gated by `alerts.test`
 * inside the content; a stray link shows nothing. */
export default function AdminAlertsScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: colors.surface.base }}>
      <Stack.Screen
        options={{
          title: t("admin.alerts.title"),
          headerShown: true,
          headerLeft: () => <HeaderBackButton />,
        }}
      />
      <AlertsAdminContent />
    </View>
  );
}
