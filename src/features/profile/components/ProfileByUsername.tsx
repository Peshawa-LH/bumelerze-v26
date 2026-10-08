import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { AccountButton } from "@/features/account/components/AccountButton";
import { CommunityError } from "@/features/community";
import { PublicProfileView } from "@/features/community/components/PublicProfileView";
import { useCommunityActions, usePublicProfile } from "@/features/community/queries";
import { isSupabaseConfigured } from "@/lib/supabase";
import { useTheme } from "@/theme";
import { OwnProfile } from "./OwnProfile";

/**
 * The body of `/u/[username]`: loading, not available, not found, a failed
 * load with Retry, or the profile. When the profile turns out to be the
 * viewer's own (the server says `isSelf`), the page is the same merged own
 * view as the Profile tab, so the owner never sees a second, thinner version
 * of themselves; for anyone else it is the public view, which mounts none of
 * the owner-only sections.
 */
export function ProfileByUsername({ username }: { username: string | undefined }) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
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

  if (unavailable) {
    return <Text style={message}>{t("community.profile.unavailable")}</Text>;
  }
  if (profile.isLoading) {
    return <Text style={message}>{t("eventDetail.loading")}</Text>;
  }
  if (profile.isError) {
    return (
      <View style={{ gap: spacing[3] }}>
        <Text style={message}>{t("eventHub.loadError")}</Text>
        <AccountButton label={t("events.retry")} onPress={() => void profile.refetch()} />
      </View>
    );
  }
  if (!profile.data) {
    return (
      <Text style={message} testID="profile-not-found">
        {t("community.profile.notFound")}
      </Text>
    );
  }
  return profile.data.isSelf ? (
    <OwnProfile profile={profile.data} actions={actions} />
  ) : (
    <PublicProfileView profile={profile.data} actions={actions} />
  );
}
