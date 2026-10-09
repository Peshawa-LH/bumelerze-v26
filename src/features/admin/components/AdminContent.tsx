import { useRouter } from "expo-router";
import { ScrollView, StyleSheet, Text } from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SettingsGroup } from "@/features/account/components/SettingsGroup";
import { SettingsRow } from "@/features/account/components/SettingsRow";
import type { ContentFilterTransport } from "@/features/contentfilter/transport";
import type { EventHubTransport } from "@/features/eventhub/transport";
import type { PostsTransport } from "@/features/posts/transport";
import { useTheme } from "@/theme";
import { formatCount } from "../people/format";
import { useInboxCounts } from "../inbox/queries";
import type { InboxTransport } from "../inbox/transport";
import { useAdminAccess } from "../queries";
import type { AdminTransport } from "../transport";
import { ModerationQueueSection } from "./ModerationQueueSection";
import { RankBadgesSection } from "./RankBadgesSection";
import { ReportedPostsSection } from "./ReportedPostsSection";
import { ReportedProfilesSection } from "./ReportedProfilesSection";

/** The hidden admin screen. Each section appears only for the permission it
 * needs (`people.view` for People, `comments.moderate` for the queue and
 * reported profiles, `badges.grant` for rank badges, `audit.read` for the
 * Activity log, `feedback.manage` for the feedback inbox and `photos.moderate`
 * for felt photos), and everything is hidden for people without any, so a stray
 * link shows nothing. Resetting a password lives on a person's page (People). */
export function AdminContent({
  transport,
  hubTransport,
  postsTransport,
  inboxTransport,
  filterTransport,
}: {
  transport?: AdminTransport;
  hubTransport?: EventHubTransport;
  postsTransport?: PostsTransport;
  inboxTransport?: InboxTransport;
  /** Test seam for the word filter's hold notes and Approve (migration 0059). */
  filterTransport?: ContentFilterTransport;
}) {
  const { t, i18n } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const access = useAdminAccess(hubTransport);
  const counts = useInboxCounts(
    access.canManageFeedback || access.canModeratePhotos,
    inboxTransport,
  );
  const openFeedback = counts.data?.feedback
    ? counts.data.feedback.unseen + counts.data.feedback.inReview
    : null;
  const pendingPhotos = counts.data?.photosPending ?? null;
  const shared = {
    ...(transport ? { transport } : {}),
    ...(hubTransport ? { hubTransport } : {}),
  };
  const filter = filterTransport ? { filterTransport } : {};

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
      {access.canViewPeople ? (
        <SettingsGroup testID="admin-people-group">
          <SettingsRow
            icon="people-outline"
            label={t("admin.people.title")}
            onPress={() => router.push("/admin/people")}
            testID="admin-people-row"
          />
        </SettingsGroup>
      ) : null}
      {access.canManageFeedback || access.canModeratePhotos ? (
        <SettingsGroup testID="admin-inbox-group">
          {access.canManageFeedback ? (
            <SettingsRow
              icon="mail-unread-outline"
              label={t("admin.feedback.title")}
              value={
                openFeedback !== null && openFeedback > 0
                  ? t("admin.feedback.openCount", {
                      count: formatCount(openFeedback, i18n.language),
                    })
                  : null
              }
              onPress={() => router.push("/admin/feedback")}
              testID="admin-feedback-row"
            />
          ) : null}
          {access.canModeratePhotos ? (
            <SettingsRow
              icon="images-outline"
              label={t("admin.photos.title")}
              value={
                pendingPhotos !== null && pendingPhotos > 0
                  ? t("admin.photos.pendingCount", {
                      count: formatCount(pendingPhotos, i18n.language),
                    })
                  : null
              }
              onPress={() => router.push("/admin/photos")}
              testID="admin-photos-row"
            />
          ) : null}
        </SettingsGroup>
      ) : null}
      {access.canModerate ? (
        <>
          <ModerationQueueSection canDelete={access.canDelete} {...shared} {...filter} />
          <ReportedProfilesSection
            canRestrict={access.canRestrict}
            canSuspend={access.canSuspend}
            canViewPeople={access.canViewPeople}
            {...shared}
          />
          <ReportedPostsSection
            canRemove={access.canRemovePosts}
            canRestrict={access.canRestrict}
            canSuspend={access.canSuspend}
            {...shared}
            {...filter}
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
      {access.has("filter.manage") ? (
        <SettingsGroup testID="admin-filter-group">
          <SettingsRow
            icon="funnel-outline"
            label={t("contentFilter.title")}
            onPress={() => router.push("/admin/filter")}
            testID="admin-filter-row"
          />
        </SettingsGroup>
      ) : null}
      {access.canGrant ? <RankBadgesSection {...shared} /> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { width: "100%", maxWidth: 560, alignSelf: "center" },
});
