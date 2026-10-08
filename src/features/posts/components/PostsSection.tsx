import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { AccountButton } from "@/features/account/components/AccountButton";
import { useAccount } from "@/features/account/use-account";
import { CommunityError, type PublicProfile } from "@/features/community/types";
import { ActionButton } from "@/features/eventhub/components/ActionButton";
import type { EventHubTransport } from "@/features/eventhub/transport";
import { useMyRestriction } from "@/features/restrictions/queries";
import { isSupabaseConfigured } from "@/lib/supabase";
import { useTheme } from "@/theme";
import { useCanRemovePosts, usePostActions, usePosts } from "../queries";
import type { PostsTransport } from "../transport";
import { PostComposer } from "./PostComposer";
import { PostItem } from "./PostItem";

interface PostsSectionProps {
  profile: PublicProfile;
  transport?: PostsTransport | undefined;
  hubTransport?: EventHubTransport | undefined;
}

/**
 * The "Posts" part of a public profile. Shows, in order of what the viewer may
 * do: nothing (blocked, or the server has no posts yet), "Posts are visible to
 * followers" (private account the viewer cannot see into), or the composer
 * (own page) plus the list, newest first, "Show more" for older ones.
 */
export function PostsSection({ profile, transport, hubTransport }: PostsSectionProps) {
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
    />
  );
}

function PostsList({
  profile,
  heading,
  transport,
  hubTransport,
}: PostsSectionProps & { heading: ReactNode }) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const account = useAccount();
  const list = usePosts(profile.userId, { includeRemoved: profile.isSelf }, transport);
  const actions = usePostActions(transport);
  const canAdminRemove = useCanRemovePosts(hubTransport);
  const mine = useMyRestriction();
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
  } else if (list.posts.length === 0) {
    body = (
      <Text style={meta} testID="posts-empty">
        {t("posts.empty")}
      </Text>
    );
  } else {
    body = (
      <>
        {list.posts.map((post) => (
          <PostItem
            key={post.id}
            post={post}
            isOwn={profile.isSelf}
            canReport={viewerId !== null}
            canAdminRemove={canAdminRemove}
            nowMs={list.updatedAt}
            actions={actions}
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
