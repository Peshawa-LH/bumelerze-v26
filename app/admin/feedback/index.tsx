import { Stack } from "expo-router";
import { View } from "react-native";
import { useTranslation } from "react-i18next";

import { HeaderBackButton } from "@/components/HeaderBackButton";
import { lazyScreenContent } from "@/components/LazyScreenContent";
import { loadAdminArea } from "@/features/admin/area-loader";
import { useTheme } from "@/theme";

// On the web, downloaded on first use (src/features/admin/area.ts).
const FeedbackInboxContent = lazyScreenContent(
  loadAdminArea,
  (area) => area.FeedbackInboxContent,
);

/** Admin > Feedback: every message sent from the app, badge requests and
 * appeals included. Gated by `feedback.manage` inside the content. */
export default function AdminFeedbackScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: colors.surface.base }}>
      <Stack.Screen
        options={{
          title: t("admin.feedback.title"),
          headerShown: true,
          headerLeft: () => <HeaderBackButton />,
        }}
      />
      <FeedbackInboxContent />
    </View>
  );
}
