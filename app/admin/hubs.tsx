import { Stack } from "expo-router";
import { View } from "react-native";
import { useTranslation } from "react-i18next";

import { HeaderBackButton } from "@/components/HeaderBackButton";
import { lazyScreenContent } from "@/components/LazyScreenContent";
import { loadAdminArea } from "@/features/admin/area-loader";
import { useTheme } from "@/theme";

// On the web, downloaded on first use (src/features/admin/area.ts).
const HubsContent = lazyScreenContent(loadAdminArea, (area) => area.HubsContent);

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
