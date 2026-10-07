import { Stack } from "expo-router";
import { View } from "react-native";
import { useTranslation } from "react-i18next";

import { HeaderBackButton } from "@/components/HeaderBackButton";
import { AdminContent } from "@/features/admin";
import { useTheme } from "@/theme";

/** Hidden admin screen: comment review queue, reported profiles and rank
 * badges. Not linked from anywhere except My account, and only for accounts
 * holding an admin permission. */
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
