import { Stack, useLocalSearchParams } from "expo-router";
import { View } from "react-native";
import { useTranslation } from "react-i18next";

import { HeaderBackButton } from "@/components/HeaderBackButton";
import { FeedbackDetailContent } from "@/features/admin/inbox";
import { useTheme } from "@/theme";

/** Admin > Feedback > one message: text, sender, screenshots, status and
 * triage note; grant a requested badge; the restriction an appeal is about. */
export default function AdminFeedbackDetailScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <View style={{ flex: 1, backgroundColor: colors.surface.base }}>
      <Stack.Screen
        options={{
          title: t("admin.feedback.detailTitle"),
          headerShown: true,
          headerLeft: () => <HeaderBackButton />,
        }}
      />
      <FeedbackDetailContent feedbackId={typeof id === "string" ? id : ""} />
    </View>
  );
}
