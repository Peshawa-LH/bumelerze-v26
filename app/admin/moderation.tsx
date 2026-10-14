import { Stack } from "expo-router";
import { View } from "react-native";
import { useTranslation } from "react-i18next";

import { HeaderBackButton } from "@/components/HeaderBackButton";
import { lazyScreenContent } from "@/components/LazyScreenContent";
import { loadAdminArea } from "@/features/admin/area-loader";
import { useTheme } from "@/theme";

// On the web, downloaded on first use (src/features/admin/area.ts).
const ModerationContent = lazyScreenContent(
  loadAdminArea,
  (area) => area.ModerationContent,
);

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
