import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAccount } from "@/features/account/use-account";
import { ActivityBell } from "@/features/activity";
import { ProfileShareSheet } from "@/features/community/components/ProfileShareSheet";
import { ProfileTab } from "@/features/profile";
import { useTheme } from "@/theme";
import { useTabBarScroll } from "@/features/tab-bar";

/**
 * The Profile tab (D79, redesigned in review note 5.1): one page for "me".
 * The top bar carries the @username, the activity bell and the QR of the
 * profile link (mockup 3a). For a signed-in account the public profile comes
 * first (what other people see), then, below "Only you see this", the
 * owner's tools, then Posts and Comments. A guest sees "Profile", the sign-up
 * invitation and what is on the device. Sits directly in the tab navigator
 * (no stack header), so it owns its top safe-area padding like Settings does.
 */
export default function ProfileScreen() {
  const tabBarScroll = useTabBarScroll();
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const account = useAccount();
  const [showQr, setShowQr] = useState(false);
  const username =
    account.status === "account" ? (account.profile?.username ?? null) : null;

  return (
    <ScrollView
      {...tabBarScroll}
      style={{ backgroundColor: colors.surface.base }}
      contentContainerStyle={[
        styles.content,
        {
          paddingTop: insets.top + spacing[4],
          paddingBottom: insets.bottom + spacing[6],
          paddingStart: spacing[4],
          paddingEnd: spacing[4],
          gap: spacing[4],
        },
      ]}
    >
      <View style={[styles.header, { gap: spacing[1] }]}>
        <Text
          accessibilityRole="header"
          numberOfLines={1}
          style={[
            styles.title,
            {
              color: colors.text.primary,
              fontSize: typography.h2.fontSize,
              lineHeight: typography.h2.lineHeight,
              fontWeight: typography.h2.fontWeight,
            },
            username ? { writingDirection: "ltr" } : null,
          ]}
          testID="profile-title"
        >
          {username ?? t("tabs.profile")}
        </Text>
        {/* Activity (0061): follows, replies, hearts, reviews, family check-ins. */}
        <ActivityBell />
        {username ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("profile.qr")}
            onPress={() => setShowQr(true)}
            hitSlop={4}
            style={styles.icon}
            testID="profile-qr"
          >
            <Ionicons name="qr-code-outline" size={24} color={colors.text.primary} />
          </Pressable>
        ) : null}
      </View>
      <ProfileTab />
      {showQr && username ? (
        <ProfileShareSheet
          username={username}
          displayName={account.profile?.displayName ?? username}
          onClose={() => setShowQr(false)}
        />
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, width: "100%", maxWidth: 600, alignSelf: "center" },
  header: { flexDirection: "row", alignItems: "center" },
  title: { flex: 1 },
  icon: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
});
