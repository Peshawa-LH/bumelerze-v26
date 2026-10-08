import { Stack } from "expo-router";
import { View } from "react-native";
import { useTranslation } from "react-i18next";

import { HeaderBackButton } from "@/components/HeaderBackButton";
import { HiddenRemovedContent } from "@/features/admin/components/HiddenRemovedContent";
import { useTheme } from "@/theme";

/** Admin > Hidden and removed: what moderators hid and admins removed in the
 * last 30 days, with Restore. Gated by `comments.moderate` inside the content;
 * a stray link shows nothing. */
export default function AdminHiddenScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: colors.surface.base }}>
      <Stack.Screen
        options={{
          title: t("admin.hidden.title"),
          headerShown: true,
          headerLeft: () => <HeaderBackButton />,
        }}
      />
      <HiddenRemovedContent />
    </View>
  );
}
