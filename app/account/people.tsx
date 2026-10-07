import { Stack } from "expo-router";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { HeaderBackButton } from "@/components/HeaderBackButton";
import { useAccount } from "@/features/account/use-account";
import { BlockedSection } from "@/features/community/components/BlockedSection";
import { FollowRequestsSection } from "@/features/community/components/FollowRequestsSection";
import { useBlockedPeople, useFollowRequests } from "@/features/community/queries";
import { useTheme } from "@/theme";

/** People: follow requests to accept or decline, and blocked accounts. */
export default function PeopleSettingsScreen() {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const account = useAccount();
  const requests = useFollowRequests();
  const blocked = useBlockedPeople();
  const nothing = (requests.data?.length ?? 0) === 0 && (blocked.data?.length ?? 0) === 0;

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
        {nothing ? (
          <Text
            testID="people-nothing"
            style={{
              color: colors.text.secondary,
              fontSize: typography.bodyDefault.fontSize,
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
