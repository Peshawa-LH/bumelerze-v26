import { useRouter } from "expo-router";
import { ScrollView, StyleSheet, Text } from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SettingsGroup } from "@/features/account/components/SettingsGroup";
import { SettingsRow } from "@/features/account/components/SettingsRow";
import type { EventHubTransport } from "@/features/eventhub/transport";
import type { PostsTransport } from "@/features/posts/transport";
import { useTheme } from "@/theme";
import { useAdminAccess } from "../queries";
import type { AdminTransport } from "../transport";
import { PasswordResetSection } from "./PasswordResetSection";
import { ModerationQueueSection } from "./ModerationQueueSection";
import { RankBadgesSection } from "./RankBadgesSection";
import { ReportedPostsSection } from "./ReportedPostsSection";
import { ReportedProfilesSection } from "./ReportedProfilesSection";

/** The hidden admin screen. Each section appears only for the permission it
 * needs (`comments.moderate` for the queue and reported profiles,
 * `badges.grant` for rank badges, `accounts.reset_password` for password
 * resets, `audit.read` for the Activity log), and everything is hidden for people
 * without any, so a stray link shows nothing. */
export function AdminContent({
  transport,
  hubTransport,
  postsTransport,
}: {
  transport?: AdminTransport;
  hubTransport?: EventHubTransport;
  postsTransport?: PostsTransport;
}) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const access = useAdminAccess(hubTransport);
  const shared = {
    ...(transport ? { transport } : {}),
    ...(hubTransport ? { hubTransport } : {}),
  };

  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[
        styles.content,
        {
          gap: spacing[5],
          padding: spacing[4],
          paddingBottom: insets.bottom + spacing[6],
        },
      ]}
    >
      {access.any || access.isLoading ? null : (
        <Text
          testID="admin-no-access"
          style={{
            color: colors.text.secondary,
            fontSize: typography.bodyDefault.fontSize,
            lineHeight: typography.bodyDefault.lineHeight,
          }}
        >
          {t("community.errors.forbidden")}
        </Text>
      )}
      {access.canModerate ? (
        <>
          <ModerationQueueSection canDelete={access.canDelete} {...shared} />
          <ReportedProfilesSection
            canRestrict={access.canRestrict}
            canSuspend={access.canSuspend}
            {...shared}
          />
          <ReportedPostsSection
            canRemove={access.canRemovePosts}
            canRestrict={access.canRestrict}
            canSuspend={access.canSuspend}
            {...shared}
            {...(postsTransport ? { postsTransport } : {})}
          />
        </>
      ) : null}
      {access.canModerate || access.canAudit || access.canRestrict ? (
        <SettingsGroup testID="admin-activity-group">
          {access.canModerate ? (
            <SettingsRow
              icon="eye-off-outline"
              label={t("admin.hidden.title")}
              onPress={() => router.push("/admin/hidden")}
              testID="admin-hidden-row"
            />
          ) : null}
          {access.canRestrict ? (
            <SettingsRow
              icon="hand-left-outline"
              label={t("restrictions.list.title")}
              onPress={() => router.push("/admin/limited")}
              testID="admin-limited-row"
            />
          ) : null}
          {access.canAudit ? (
            <SettingsRow
              icon="time-outline"
              label={t("admin.activity.title")}
              onPress={() => router.push("/admin/activity")}
              testID="admin-activity-row"
            />
          ) : null}
        </SettingsGroup>
      ) : null}
      {access.canGrant ? <RankBadgesSection {...shared} /> : null}
      {access.canResetPasswords ? (
        <PasswordResetSection {...(transport ? { transport } : {})} />
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { width: "100%", maxWidth: 560, alignSelf: "center" },
});
