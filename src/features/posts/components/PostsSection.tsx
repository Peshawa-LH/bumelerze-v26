import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { AccountButton } from "@/features/account/components/AccountButton";
import { useAccount } from "@/features/account/use-account";
import { CommunityError, type PublicProfile } from "@/features/community/types";
import { ActionButton } from "@/features/eventhub/components/ActionButton";
import { useMyPermissions } from "@/features/eventhub/queries";
import type { EventHubTransport } from "@/features/eventhub/transport";
import { useMyRestriction } from "@/features/restrictions/queries";
import { isSupabaseConfigured } from "@/lib/supabase";
import { useTheme } from "@/theme";
import { useCanRemovePosts, usePinnedPost, usePostActions, usePosts } from "../queries";
import type { PostsTransport } from "../transport";
import type { CommentsViewer } from "../comments/components/PostCommentsSection";
import type { PostCommentsTransport } from "../comments/transport";
import { PostComposer } from "./PostComposer";
import { PostItem } from "./PostItem";

interface PostsSectionProps {
  profile: PublicProfile;
  transport?: PostsTransport | undefined;
  hubTransport?: EventHubTransport | undefined;
  /** Test seam for the comments under posts (migration 0063). */
  commentsTransport?: PostCommentsTransport | undefined;
}

/**
 * The "Posts" part of a public profile. Shows, in order of what the viewer may
 * do: nothing (blocked, or the server has no posts yet), "Posts are visible to
 * followers" (private account the viewer cannot see into), or the composer
 * (own page) plus the pinned post (if any) and the list, newest first, "Show
 * more" for older ones.
 */
export function PostsSection({
  profile,
  transport,
  hubTransport,
  commentsTransport,
}: PostsSectionProps) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const meta = {
    color: colors.text.secondary,
    fontSize: typography.bodyMeta.fontSize,
    lineHeight: typography.bodyMeta.lineHeight,
  } as const;

  const heading = (
    <Text
      accessibilityRole="header"
      style={[typography.h3, { color: colors.text.primary }]}
    >
      {t("posts.title")}
    </Text>
  );

  if (profile.isBlocked) {
    return null;
  }
  if (!profile.canViewFull) {
    // A private account: the basics are public, the posts are for followers.
    return profile.isPrivate ? (
      <View style={{ gap: spacing[2] }} testID="posts-gate">
        {heading}
        <Text style={meta}>{t("posts.gate")}</Text>
      </View>
    ) : null;
  }
  if (!isSupabaseConfigured()) {
    return null;
  }
  return (
    <PostsList
      profile={profile}
      heading={heading}
      transport={transport}
      hubTransport={hubTransport}
      commentsTransport={commentsTransport}
    />
  );
}

function PostsList({
  profile,
  heading,
  transport,
  hubTransport,
  commentsTransport,
}: PostsSectionProps & { heading: ReactNode }) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const account = useAccount();
  const list = usePosts(profile.userId, { includeRemoved: profile.isSelf }, transport);
  const pinnedId = profile.details?.pinnedPostId ?? null;
  const pinned = usePinnedPost(profile.userId, pinnedId, transport);
  const actions = usePostActions(transport);
  const canAdminRemove = useCanRemovePosts(hubTransport);
  const mine = useMyRestriction();
  const perms = useMyPermissions(
    account.status === "account" ? account.userId : null,
    hubTransport,
  );
  const meta = {
    color: colors.text.secondary,
    fontSize: typography.bodyMeta.fontSize,
    lineHeight: typography.bodyMeta.lineHeight,
  } as const;

  // Before migration 0050 is applied the whole section stays out of the way.
  if (list.isUnavailable) {
    return null;
  }

  const viewerId = account.userId;
  // "Helpful" needs a real account; a guest identity only reads the count.
  const canHelp = account.status === "account";
  const pinnedPost = pinned.post && pinned.post.status === "visible" ? pinned.post : null;
  const commentsViewer: CommentsViewer = {
    userId: viewerId,
    isAccount: canHelp,
    isLimited: mine.isLimited,
    canReport: viewerId !== null,
    // only a real answer from the server counts (as for the admin tools)
    isModerator: !perms.legacy && perms.has("comments.moderate"),
    canRemove: !perms.legacy && perms.has("comments.delete"),
  };
  const commentProps = {
    commentsViewer,
    ...(commentsTransport ? { commentsTransport } : {}),
  };
  const listed = pinnedPost
    ? list.posts.filter((post) => post.id !== pinnedPost.id)
    : list.posts;
  const composer =
    profile.isSelf && viewerId !== null ? (
      <PostComposer
        disabled={mine.isLimited}
        onSubmit={async (body) => {
          try {
            await actions.create(viewerId, body);
          } catch (error) {
            // refused because of a limit this screen did not know yet
            if (error instanceof CommunityError && error.code === "restricted") {
              void mine.refresh();
            }
            throw error;
          }
        }}
      />
    ) : null;

  let body: ReactNode;
  if (list.isLoading) {
    body = <Text style={meta}>{t("eventDetail.loading")}</Text>;
  } else if (list.isError) {
    body = (
      <View style={{ gap: spacing[2] }}>
        <Text style={meta} testID="posts-error">
          {t("posts.loadError")}
        </Text>
        <AccountButton label={t("events.retry")} onPress={() => void list.refetch()} />
      </View>
    );
  } else if (listed.length === 0 && !pinnedPost) {
    body = (
      <Text style={meta} testID="posts-empty">
        {t("posts.empty")}
      </Text>
    );
  } else {
    body = (
      <>
        {pinnedPost ? (
          <PostItem
            key={`pinned-${pinnedPost.id}`}
            post={pinnedPost}
            isOwn={profile.isSelf}
            isPinned
            canReport={viewerId !== null}
            canHelp={canHelp}
            canAdminRemove={canAdminRemove}
            nowMs={pinned.updatedAt || list.updatedAt}
            actions={actions}
            {...commentProps}
          />
        ) : null}
        {listed.map((post) => (
          <PostItem
            key={post.id}
            post={post}
            isOwn={profile.isSelf}
            canReport={viewerId !== null}
            canHelp={canHelp}
            canAdminRemove={canAdminRemove}
            nowMs={list.updatedAt}
            actions={actions}
            {...commentProps}
          />
        ))}
        {list.hasMore ? (
          <View style={styles.more}>
            <ActionButton
              label={t("posts.loadMore")}
              disabled={list.isFetchingMore}
              onPress={list.loadMore}
              testID="posts-load-more"
            />
          </View>
        ) : null}
      </>
    );
  }

  return (
    <View style={{ gap: spacing[2] }} testID="posts-section">
      {heading}
      {composer}
      {body}
    </View>
  );
}

const styles = StyleSheet.create({
  more: { alignItems: "flex-start" },
});
