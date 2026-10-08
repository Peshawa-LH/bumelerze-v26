import { Stack } from "expo-router";
import { View } from "react-native";
import { useTranslation } from "react-i18next";

import { HeaderBackButton } from "@/components/HeaderBackButton";
import { ActivityContent } from "@/features/admin/components/ActivityContent";
import { useTheme } from "@/theme";

/** Admin > Activity: the audit log (who did what, when, why). Gated by the
 * `audit.read` permission inside the content; a stray link shows nothing. */
export default function AdminActivityScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: colors.surface.base }}>
      <Stack.Screen
        options={{
          title: t("admin.activity.title"),
          headerShown: true,
          headerLeft: () => <HeaderBackButton />,
        }}
      />
      <ActivityContent />
    </View>
  );
}
