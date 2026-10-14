import { Stack } from "expo-router";
import { View } from "react-native";
import { useTranslation } from "react-i18next";

import { HeaderBackButton } from "@/components/HeaderBackButton";
import { AdminContent } from "@/features/admin";
import { useTheme } from "@/theme";

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
