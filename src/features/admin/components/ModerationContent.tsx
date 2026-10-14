import { useRouter } from "expo-router";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { SettingsGroup } from "@/features/account/components/SettingsGroup";
import { SettingsRow } from "@/features/account/components/SettingsRow";
import type { ContentFilterTransport } from "@/features/contentfilter/transport";
import type { EventHubTransport } from "@/features/eventhub/transport";
import type { PostsTransport } from "@/features/posts/transport";
import type { PostCommentsTransport } from "@/features/posts/comments/transport";
import { useTheme } from "@/theme";
import { useInboxCounts } from "../inbox/queries";
import type { InboxTransport } from "../inbox/transport";
import { formatCount } from "../people/format";
import { useAdminAccess } from "../queries";
import type { AdminTransport } from "../transport";
import { ToolPage } from "../ui";
import { ModerationQueueSection } from "./ModerationQueueSection";
import { PostCommentQueueSection } from "./PostCommentQueueSection";
import { ReportedPostsSection } from "./ReportedPostsSection";
import { ReportedProfilesSection } from "./ReportedProfilesSection";

/**
 * Admin > Moderation queue: everything waiting for a decision, in one page
 * (it used to be inline on the admin home). Felt photos and limited accounts
 * open from the top; then hub comments, reported profiles, reported or held
 * posts, and comments under posts. Same sections, same actions as before.
 */
export function ModerationContent({
  transport,
  hubTransport,
  postsTransport,
  inboxTransport,
  filterTransport,
  postCommentsTransport,
}: {
  transport?: AdminTransport;
  hubTransport?: EventHubTransport;
  postsTransport?: PostsTransport;
  inboxTransport?: InboxTransport;
  filterTransport?: ContentFilterTransport;
  postCommentsTransport?: PostCommentsTransport;
}) {
  const { t, i18n } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const router = useRouter();
  const access = useAdminAccess(hubTransport);
  const counts = useInboxCounts(access.canModeratePhotos, inboxTransport);
  const pendingPhotos = counts.data?.photosPending ?? null;
  const shared = {
    ...(transport ? { transport } : {}),
    ...(hubTransport ? { hubTransport } : {}),
  };
  const filter = filterTransport ? { filterTransport } : {};
  const allowed = access.canModerate || access.canModeratePhotos || access.canRestrict;

  if (!allowed) {
    return access.isLoading ? null : (
      <ToolPage testID="moderation-page">
        <Text
          testID="moderation-no-access"
          style={[typography.bodyDefault, { color: colors.text.secondary }]}
        >
          {t("community.errors.forbidden")}
        </Text>
      </ToolPage>
    );
  }

  return (
    <ToolPage testID="moderation-page" hint={t("admin.moderation.hint")}>
      {access.canModeratePhotos || access.canRestrict ? (
        <SettingsGroup testID="moderation-links">
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
          {access.canRestrict ? (
            <SettingsRow
              icon="hand-left-outline"
              label={t("restrictions.list.title")}
              onPress={() => router.push("/admin/limited")}
              testID="admin-limited-row"
            />
          ) : null}
        </SettingsGroup>
      ) : null}
      {access.canModerate ? (
        <View style={{ gap: spacing[5] }}>
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
          <PostCommentQueueSection
            canRemove={access.canDelete}
            {...filter}
            {...(postCommentsTransport ? { transport: postCommentsTransport } : {})}
          />
        </View>
      ) : null}
    </ToolPage>
  );
}
