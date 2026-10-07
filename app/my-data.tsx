import { Stack, useRouter } from "expo-router";
import { ScrollView, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { HeaderBackButton } from "@/components/HeaderBackButton";
import { CommunityRows } from "@/features/account/components/CommunityRows";
import { DeleteAccountRow } from "@/features/account/components/DeleteAccountRow";
import { MyLocationRow } from "@/features/account/components/MyLocationRow";
import { PrivacyRow } from "@/features/account/components/PrivacyRow";
import { ProfileHeader } from "@/features/account/components/ProfileHeader";
import { SettingsGroup } from "@/features/account/components/SettingsGroup";
import { SettingsRow } from "@/features/account/components/SettingsRow";
import { SignOutRow } from "@/features/account/components/SignOutRow";
import { SignUpInvite } from "@/features/account/components/SignUpInvite";
import { StatsStrip } from "@/features/account/components/StatsStrip";
import { useMySummary } from "@/features/account/use-my-summary";
import { useAccount } from "@/features/account/use-account";
import { BadgesSection } from "@/features/badges";
import { MyHomeCard } from "@/features/building";
import { MyReportsSection } from "@/features/mydata";
import { useTheme } from "@/theme";

/**
 * My account: identity first, achievements second, things you can do third,
 * plumbing last (spec: account-page-redesign-2026-10-04). The route and the
 * title stay `/my-data` / "My account". Each block is its own component; this
 * file only orders them. The page is a plain ScrollView: the long list of all
 * reports lives on `/my-reports`.
 */
export default function MyDataScreen() {
  const { t } = useTranslation();
  const { colors, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const account = useAccount();
  const summary = useMySummary();
  const isAccount = account.status === "account";

  return (
    <View style={[styles.flex, { backgroundColor: colors.surface.base }]}>
      <Stack.Screen
        options={{
          title: t("myData.title"),
          headerShown: true,
          headerLeft: () => <HeaderBackButton />,
        }}
      />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            gap: spacing[4],
            paddingHorizontal: spacing[4],
            paddingTop: spacing[4],
            paddingBottom: insets.bottom + spacing[6],
          },
        ]}
      >
        <ProfileHeader memberSince={summary.memberSince} roles={summary.roles} />
        {account.status === "anonymous" ? <SignUpInvite /> : null}
        <StatsStrip
          reports={summary.counts.reports}
          comments={summary.counts.comments}
          helpful={summary.counts.helpfulReceived}
          badgesEarned={summary.badgesEarned}
          badgesTotal={summary.badgesTotal}
          signedIn={isAccount}
          loading={summary.statsLoading}
        />
        <BadgesSection
          entries={summary.badges}
          earned={summary.badgesEarned}
          total={summary.badgesTotal}
        />
        <CommunityRows />
        <MyHomeCard />
        <MyReportsSection />
        <SettingsGroup>
          <MyLocationRow />
          <SettingsRow
            icon="notifications-outline"
            label={t("settings.notificationsSectionTitle")}
            onPress={() => router.push("/notification-settings")}
            testID="account-notifications-row"
          />
          <PrivacyRow email={account.email} />
          {isAccount ? <SignOutRow /> : null}
        </SettingsGroup>
        {isAccount ? <DeleteAccountRow /> : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { width: "100%", maxWidth: 560, alignSelf: "center" },
});
