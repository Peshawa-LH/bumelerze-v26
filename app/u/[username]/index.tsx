import { Stack, useLocalSearchParams } from "expo-router";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { HeaderBackButton } from "@/components/HeaderBackButton";
import { AccountButton } from "@/features/account/components/AccountButton";
import { CommunityError } from "@/features/community";
import { useCommunityActions, usePublicProfile } from "@/features/community/queries";
import { PublicProfileView } from "@/features/community/components/PublicProfileView";
import { isSupabaseConfigured } from "@/lib/supabase";
import { useTheme } from "@/theme";

/**
 * Public profile page `/u/[username]`, opened from a name or photo in the
 * Event hub. Every state has a friendly message: profiles not available yet
 * (no server, or the community migration is not applied), no such account,
 * and a failed load with Retry.
 */
export default function PublicProfileScreen() {
  const { username } = useLocalSearchParams<{ username: string }>();
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const profile = usePublicProfile(username);
  const actions = useCommunityActions();

  const message = {
    color: colors.text.secondary,
    fontSize: typography.bodyDefault.fontSize,
    lineHeight: typography.bodyDefault.lineHeight,
  } as const;

  const unavailable =
    !isSupabaseConfigured() ||
    (profile.isError &&
      profile.error instanceof CommunityError &&
      profile.error.code === "unavailable");

  let body;
  if (unavailable) {
    body = <Text style={message}>{t("community.profile.unavailable")}</Text>;
  } else if (profile.isLoading) {
    body = <Text style={message}>{t("eventDetail.loading")}</Text>;
  } else if (profile.isError) {
    body = (
      <View style={{ gap: spacing[3] }}>
        <Text style={message}>{t("eventHub.loadError")}</Text>
        <AccountButton label={t("events.retry")} onPress={() => void profile.refetch()} />
      </View>
    );
  } else if (!profile.data) {
    body = (
      <Text style={message} testID="profile-not-found">
        {t("community.profile.notFound")}
      </Text>
    );
  } else {
    body = <PublicProfileView profile={profile.data} actions={actions} />;
  }

  return (
    <View style={[styles.flex, { backgroundColor: colors.surface.base }]}>
      <Stack.Screen
        options={{
          title: t("community.profile.title"),
          headerShown: true,
          headerLeft: () => <HeaderBackButton />,
        }}
      />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            padding: spacing[4],
            paddingBottom: insets.bottom + spacing[6],
          },
        ]}
      >
        {body}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { width: "100%", maxWidth: 560, alignSelf: "center" },
});
