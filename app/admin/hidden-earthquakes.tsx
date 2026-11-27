import { Stack } from "expo-router";
import { View } from "react-native";
import { useTranslation } from "react-i18next";

import { HeaderBackButton } from "@/components/HeaderBackButton";
import { lazyScreenContent } from "@/components/LazyScreenContent";
import { loadAdminArea } from "@/features/admin/area-loader";
import { useTheme } from "@/theme";

// On the web, downloaded on first use (src/features/admin/area.ts).
const HiddenEventsContent = lazyScreenContent(
  loadAdminArea,
  (area) => area.HiddenEventsContent,
);

/** Admin > Hidden earthquakes: hide an earthquake for everyone and show it
 * again (`events.hide`, migration 0085). Not `/admin/hidden`: that is
 * Hidden & removed (comments and posts). */
export default function AdminHiddenEarthquakesScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: colors.surface.base }}>
      <Stack.Screen
        options={{
          title: t("admin.tools.hiddenEvents"),
          headerShown: true,
          headerLeft: () => <HeaderBackButton />,
        }}
      />
      <HiddenEventsContent />
    </View>
  );
}
