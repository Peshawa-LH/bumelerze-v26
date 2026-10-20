import * as Crypto from "expo-crypto";
import { useRouter } from "expo-router";
import { useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { communityErrorText } from "@/features/community/error-text";
import { CommunityError } from "@/features/community/types";
import { ActionButton } from "@/features/eventhub/components/ActionButton";
import { CommentComposer } from "@/features/eventhub/components/CommentComposer";
import { isolateNumeric } from "@/features/events";
import type { GuidelinesTransport } from "@/features/guidelines";
import type { MentionsTransport } from "@/features/mentions/transport";
import { useMutedIds } from "@/features/mute/queries";
import { Indented, ReplyToggle } from "@/features/social/components/ReplyToggle";
import { usePostCommentLikes } from "@/features/social/queries";
import type { SocialTransport } from "@/features/social/transport";
import { localizeDigits } from "@/lib/format-numbers";
import { useTheme, nativeFontFamily } from "@/theme";
import { usePostCommentActions, usePostComments } from "../queries";
import { buildPostThreads } from "../threads";
import type { PostCommentsTransport } from "../transport";
import { POST_COMMENT_MAX_LENGTH } from "../types";
import { PostCommentItem, type PostCommentViewer } from "./PostCommentItem";

export interface CommentsViewer extends PostCommentViewer {
  /** A real account (guests read but do not comment). */
  isAccount: boolean;
  /** The account is limited (migration 0054): no composer. */
  isLimited: boolean;
}

interface PostCommentsSectionProps {
  postId: string;
  /** The count the server gave with the post (what this viewer may see). */
  commentCount: number;
  commentsOff: boolean;
  isPostOwner: boolean;
  viewer: CommentsViewer;
  transport?: PostCommentsTransport;
  mentionsTransport?: MentionsTransport;
  guidelinesTransport?: GuidelinesTransport;
  /** Test seam for the hearts (migration 0065). */
  socialTransport?: SocialTransport;
  /** Open or closed, when the post's comment button controls it. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Open at first when not controlled (tests, a link to the post). */
  initiallyOpen?: boolean;
}

/**
 * Comments under a profile post (migration 0063), drawn with the Event
 * hub's own comment component (review note 5.1). Closed by default to keep a
 * profile light on weak networks: one line, "View all N comments", that
 * opens the conversation and loads it only then. Open: the box to write
 * (accounts who may comment; the server decides in the end), then the
 * conversations the hub's way (newest first, replies collapsed under "View N
 * replies", oldest first, one level). Turning comments off is in the post's
 * own "..." menu.
 */
export function PostCommentsSection({
  postId,
  commentCount,
  commentsOff,
  isPostOwner,
  viewer,
  transport,
  mentionsTransport,
  guidelinesTransport,
  socialTransport,
  open: openProp,
  onOpenChange,
  initiallyOpen = false,
}: PostCommentsSectionProps) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { colors, typography, spacing } = useTheme();
  const [openState, setOpenState] = useState(initiallyOpen);
  const open = openProp ?? openState;
  const setOpen = (value: boolean) => {
    setOpenState(value);
    onOpenChange?.(value);
  };
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [openThreads, setOpenThreads] = useState<ReadonlySet<string>>(new Set());
  const [heldNotice, setHeldNotice] = useState(false);
  // One id per text being written: a retry after a lost answer on a weak
  // network returns the same comment instead of a second one.
  const clientId = useRef<string | null>(null);
  const list = usePostComments(postId, open, transport);
  const likes = usePostCommentLikes(postId, open, socialTransport);
  const actions = usePostCommentActions(transport);
  const mutedIds = useMutedIds();

  const threads = useMemo(
    () => buildPostThreads(list.comments, { userId: viewer.userId, mutedIds }),
    [list.comments, viewer.userId, mutedIds],
  );

  const meta = {
    color: colors.text.secondary,
    fontSize: typography.bodyMeta.fontSize,
    fontFamily: nativeFontFamily(typography.bodyMeta),
    lineHeight: typography.bodyMeta.lineHeight,
  } as const;

  const countText = isolateNumeric(localizeDigits(String(commentCount), i18n.language));
  const toggleLabel = open
    ? t("postComments.close")
    : commentCount === 1
      ? t("postComments.viewOne")
      : commentCount > 1
        ? t("postComments.viewAll", { number: countText })
        : t("postComments.open");
  const canWrite = viewer.isAccount && !commentsOff;

  async function submit(body: string, parentId: string | null) {
    clientId.current ??= Crypto.randomUUID();
    const result = await actions.add({
      postId,
      body,
      parentId,
      clientId: clientId.current,
    });
    clientId.current = null;
    setHeldNotice(result.status === "pending");
    if (parentId) {
      setOpenThreads((openSet) => new Set(openSet).add(parentId));
    }
  }

  const composerError = (error: unknown) =>
    error instanceof CommunityError ? communityErrorText(t, error) : null;

  // Nothing to open: no comments and nobody may write one here.
  if (commentCount === 0 && !canWrite && !commentsOff) {
    return null;
  }

  return (
    <View style={{ gap: spacing[2] }} testID={`post-comments-${postId}`}>
      <View style={styles.row}>
        {commentCount > 0 || canWrite ? (
          <ActionButton
            label={toggleLabel}
            onPress={() => setOpen(!open)}
            testID={`post-comments-toggle-${postId}`}
          />
        ) : null}
        {commentsOff ? (
          <Text style={meta} testID={`post-comments-off-${postId}`}>
            {t("postComments.off")}
          </Text>
        ) : null}
      </View>

      {open ? (
        <View style={{ gap: spacing[3] }}>
          {canWrite && replyTo === null ? (
            <CommentComposer
              isAccount
              maxLength={POST_COMMENT_MAX_LENGTH}
              placeholder={t("postComments.placeholder")}
              disabled={viewer.isLimited}
              onSubmit={(body) => submit(body, null)}
              errorText={composerError}
              testID={`post-comment-composer-${postId}`}
              {...(mentionsTransport ? { mentionsTransport } : {})}
              {...(guidelinesTransport ? { guidelinesTransport } : {})}
            />
          ) : null}
          {!viewer.isAccount && viewer.userId !== null ? (
            <View style={{ gap: spacing[1] }} testID={`post-comments-guest-${postId}`}>
              <Text style={meta}>{t("postComments.accountsOnly")}</Text>
              <Pressable
                accessibilityRole="link"
                onPress={() => router.push("/account/sign-in")}
                hitSlop={8}
                style={styles.link}
              >
                <Text
                  style={{
                    color: colors.text.link,
                    fontSize: typography.labelButton.fontSize,
                    fontFamily: nativeFontFamily(typography.labelButton, "400"),
                  }}
                >
                  {t("eventHub.composer.createAccount")}
                </Text>
              </Pressable>
            </View>
          ) : null}
          {heldNotice ? (
            <Text
              style={meta}
              accessibilityLiveRegion="polite"
              testID={`post-comments-held-${postId}`}
            >
              {t("postComments.held")}
            </Text>
          ) : null}

          {list.isLoading ? (
            <Text style={meta}>{t("eventDetail.loading")}</Text>
          ) : list.isError ? (
            <View style={styles.row}>
              <Text style={meta} testID={`post-comments-error-${postId}`}>
                {t("postComments.loadError")}
              </Text>
              <ActionButton
                label={t("events.retry")}
                onPress={() => void list.refetch()}
              />
            </View>
          ) : threads.length === 0 ? (
            <Text style={meta} testID={`post-comments-empty-${postId}`}>
              {commentsOff ? t("postComments.off") : t("postComments.empty")}
            </Text>
          ) : (
            threads.map((thread) => {
              const repliesOpen = openThreads.has(thread.root.id);
              return (
                <View key={thread.root.id} style={{ gap: spacing[2] }}>
                  <PostCommentItem
                    comment={thread.root}
                    viewer={viewer}
                    isPostOwner={isPostOwner}
                    actions={actions}
                    nowMs={list.updatedAt}
                    {...(likes.likes[thread.root.id]
                      ? { like: likes.likes[thread.root.id] }
                      : {})}
                    onLike={(like) => likes.setLiked(thread.root.id, like)}
                    {...(canWrite && !viewer.isLimited
                      ? { onReply: () => setReplyTo(thread.root.id) }
                      : {})}
                  />
                  {thread.replies.length > 0 ? (
                    <ReplyToggle
                      count={thread.replies.length}
                      open={repliesOpen}
                      onToggle={() =>
                        setOpenThreads((openSet) => {
                          const next = new Set(openSet);
                          if (next.has(thread.root.id)) next.delete(thread.root.id);
                          else next.add(thread.root.id);
                          return next;
                        })
                      }
                      testID={`post-replies-toggle-${thread.root.id}`}
                    />
                  ) : null}
                  {repliesOpen
                    ? thread.replies.map((reply) => (
                        <PostCommentItem
                          key={reply.id}
                          comment={reply}
                          viewer={viewer}
                          isPostOwner={isPostOwner}
                          actions={actions}
                          nowMs={list.updatedAt}
                          isReply
                          {...(likes.likes[reply.id]
                            ? { like: likes.likes[reply.id] }
                            : {})}
                          onLike={(like) => likes.setLiked(reply.id, like)}
                        />
                      ))
                    : null}
                  {replyTo === thread.root.id ? (
                    <Indented on>
                      <CommentComposer
                        isAccount
                        autoFocus
                        maxLength={POST_COMMENT_MAX_LENGTH}
                        placeholder={t("eventHub.composer.replyPlaceholder")}
                        disabled={viewer.isLimited}
                        onSubmit={(body) => submit(body, thread.root.id)}
                        onCancel={() => setReplyTo(null)}
                        errorText={composerError}
                        testID={`post-comment-reply-composer-${thread.root.id}`}
                        {...(mentionsTransport ? { mentionsTransport } : {})}
                        {...(guidelinesTransport ? { guidelinesTransport } : {})}
                      />
                    </Indented>
                  ) : null}
                </View>
              );
            })
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", flexWrap: "wrap" },
  link: { minHeight: 44, justifyContent: "center", alignSelf: "flex-start" },
});
