import { Stack } from "expo-router";
import { View } from "react-native";
import { useTranslation } from "react-i18next";

import { HeaderBackButton } from "@/components/HeaderBackButton";
import { HubsContent } from "@/features/admin";
import { useTheme } from "@/theme";

/** Admin > Open a hub for an earthquake (`hubs.open`, migration 0066). */
export default function AdminHubsScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: colors.surface.base }}>
      <Stack.Screen
        options={{
          title: t("admin.tools.hubs"),
          headerShown: true,
          headerLeft: () => <HeaderBackButton />,
        }}
      />
      <HubsContent />
    </View>
  );
}
