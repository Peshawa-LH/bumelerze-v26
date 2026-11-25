import { Stack } from "expo-router";
import { View } from "react-native";
import { useTranslation } from "react-i18next";

import { HeaderBackButton } from "@/components/HeaderBackButton";
import { lazyScreenContent } from "@/components/LazyScreenContent";
import { loadAdminArea } from "@/features/admin/area-loader";
import { useTheme } from "@/theme";

// On the web, downloaded on first use (src/features/admin/area.ts).
const HomeScreenContent = lazyScreenContent(
  loadAdminArea,
  (area) => area.HomeScreenContent,
);

/** Admin > Home screen: the message and the chosen earthquakes at the top of
 * Home (`home.manage`, migration 0084). */
export default function AdminHomeScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: colors.surface.base }}>
      <Stack.Screen
        options={{
          title: t("admin.tools.home"),
          headerShown: true,
          headerLeft: () => <HeaderBackButton />,
        }}
      />
      <HomeScreenContent />
    </View>
  );
}
