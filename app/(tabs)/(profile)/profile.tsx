import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ActivityBell } from "@/features/activity";
import { ProfileTab } from "@/features/profile";
import { useTheme } from "@/theme";
import { useTabBarScroll } from "@/features/tab-bar";

/**
 * The Profile tab (D79, 2026-10-08): one page for "me". For a signed-in
 * account the public profile comes first (what other people see), then, below
 * "Only you see this", the things only the owner sees. A guest sees "Guest",
 * the sign-up invitation and what is on the device. Sits directly in the tab
 * navigator (no stack header), so it owns its top safe-area padding like
 * Settings does.
 */
export default function ProfileScreen() {
  const tabBarScroll = useTabBarScroll();
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      {...tabBarScroll}
      style={{ backgroundColor: colors.surface.base }}
      contentContainerStyle={[
        styles.content,
        {
          paddingTop: insets.top + spacing[6],
          paddingBottom: insets.bottom + spacing[6],
          paddingStart: spacing[5],
          paddingEnd: spacing[5],
          gap: spacing[4],
        },
      ]}
    >
      <View style={styles.header}>
        <Text
          accessibilityRole="header"
          style={{
            flex: 1,
            color: colors.text.primary,
            fontSize: typography.h1.fontSize,
            lineHeight: typography.h1.lineHeight,
            fontWeight: typography.h1.fontWeight,
          }}
        >
          {t("tabs.profile")}
        </Text>
        {/* Activity (0061): follows, replies, Helpful, reviews, family check-ins. */}
        <ActivityBell />
      </View>
      <ProfileTab />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, width: "100%", maxWidth: 600, alignSelf: "center" },
  header: { flexDirection: "row", alignItems: "center" },
});
