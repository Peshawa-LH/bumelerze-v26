import { Stack } from "expo-router";
import { View } from "react-native";
import { useTranslation } from "react-i18next";

import { HeaderBackButton } from "@/components/HeaderBackButton";
import { ModerationContent } from "@/features/admin";
import { useTheme } from "@/theme";

/** Admin > Moderation queue: felt photos, limited accounts and every queue of
 * comments, profiles and posts waiting for a decision. Gated inside the
 * content by permission; a stray link shows nothing. */
export default function AdminModerationScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: colors.surface.base }}>
      <Stack.Screen
        options={{
          title: t("admin.tools.moderation"),
          headerShown: true,
          headerLeft: () => <HeaderBackButton />,
        }}
      />
      <ModerationContent />
    </View>
  );
}
