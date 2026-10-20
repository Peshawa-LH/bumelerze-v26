import { Stack } from "expo-router";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { HeaderBackButton } from "@/components/HeaderBackButton";
import { useAccount } from "@/features/account/use-account";
import { useBlockedPeople, useFollowRequests } from "@/features/community/queries";
import { useMutedPeople } from "@/features/mute";
import { useTheme, nativeFontFamily } from "@/theme";
import { useTabBarScroll } from "@/features/tab-bar";
import { lazyScreenContent } from "@/components/LazyScreenContent";
import { loadProfileArea } from "@/features/profile/area-loader";

// On the web, downloaded on first use (src/features/profile/area.ts).
const BlockedSection = lazyScreenContent(loadProfileArea, (area) => area.BlockedSection);
const FollowRequestsSection = lazyScreenContent(
  loadProfileArea,
  (area) => area.FollowRequestsSection,
);
const MutedSection = lazyScreenContent(loadProfileArea, (area) => area.MutedSection);

/** People: follow requests to accept or decline, blocked accounts and muted people. */
export default function PeopleSettingsScreen() {
  const tabBarScroll = useTabBarScroll();
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const account = useAccount();
  const requests = useFollowRequests();
  const blocked = useBlockedPeople();
  const muted = useMutedPeople();
  const nothing =
    (requests.data?.length ?? 0) === 0 &&
    (blocked.data?.length ?? 0) === 0 &&
    (muted.data?.length ?? 0) === 0;

  return (
    <View style={[styles.flex, { backgroundColor: colors.surface.base }]}>
      <Stack.Screen
        options={{
          title: t("community.people.title"),
          headerShown: true,
          headerLeft: () => <HeaderBackButton />,
        }}
      />
      <ScrollView
        {...tabBarScroll}
        contentContainerStyle={[
          styles.content,
          {
            gap: spacing[5],
            padding: spacing[4],
            paddingBottom: insets.bottom + spacing[6],
          },
        ]}
      >
        <FollowRequestsSection />
        <BlockedSection />
        <MutedSection />
        {nothing ? (
          <Text
            testID="people-nothing"
            style={{
              color: colors.text.secondary,
              fontSize: typography.bodyDefault.fontSize,
              fontFamily: nativeFontFamily(typography.bodyDefault),
              lineHeight: typography.bodyDefault.lineHeight,
            }}
          >
            {account.status === "account"
              ? t("community.people.nothing")
              : t("community.people.needsAccount")}
          </Text>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { width: "100%", maxWidth: 560, alignSelf: "center" },
});
