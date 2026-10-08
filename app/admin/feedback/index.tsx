import { Stack } from "expo-router";
import { View } from "react-native";
import { useTranslation } from "react-i18next";

import { HeaderBackButton } from "@/components/HeaderBackButton";
import { FeedbackInboxContent } from "@/features/admin/inbox";
import { useTheme } from "@/theme";

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
