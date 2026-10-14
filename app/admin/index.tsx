import { Stack } from "expo-router";
import { View } from "react-native";
import { useTranslation } from "react-i18next";

import { HeaderBackButton } from "@/components/HeaderBackButton";
import { lazyScreenContent } from "@/components/LazyScreenContent";
import { loadAdminArea } from "@/features/admin/area-loader";
import { useTheme } from "@/theme";

// On the web, downloaded on first use (src/features/admin/area.ts).
const AdminContent = lazyScreenContent(loadAdminArea, (area) => area.AdminContent);

/** Admin home: a launcher of tool tiles (review 15.1). Linked only from
 * Profile > Only you see this, and only for accounts holding an admin
 * permission. */
export default function AdminScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: colors.surface.base }}>
      <Stack.Screen
        options={{
          title: t("admin.title"),
          headerShown: true,
          headerLeft: () => <HeaderBackButton />,
        }}
      />
      <AdminContent />
    </View>
  );
}
