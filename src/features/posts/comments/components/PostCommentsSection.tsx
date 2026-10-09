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
import { useUndoToast } from "@/features/undo/use-undo-toast";
import { localizeDigits } from "@/lib/format-numbers";
import { useTheme } from "@/theme";
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
  /** Open at first (tests, a link to the post). */
  initiallyOpen?: boolean;
}

/**
 * Comments under a profile post (migration 0063). Closed by default to keep
 * a profile light on weak networks: one line, "Comments (N)", that opens the
 * conversation and loads it only then. Open: the box to write (accounts who
 * may comment; the server decides in the end), the post's author's switch to
 * turn comments off, and the conversations the Event hub's way (newest
 * first, replies oldest first, one level).
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
  initiallyOpen = false,
}: PostCommentsSectionProps) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { colors, typography, spacing } = useTheme();
  const [open, setOpen] = useState(initiallyOpen);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [heldNotice, setHeldNotice] = useState(false);
  // One id per text being written: a retry after a lost answer on a weak
  // network returns the same comment instead of a second one.
  const clientId = useRef<string | null>(null);
  const list = usePostComments(postId, open, transport);
  const actions = usePostCommentActions(transport);
  const mutedIds = useMutedIds();
  const showUndo = useUndoToast();

  const threads = useMemo(
    () => buildPostThreads(list.comments, { userId: viewer.userId, mutedIds }),
    [list.comments, viewer.userId, mutedIds],
  );

  const meta = {
    color: colors.text.secondary,
    fontSize: typography.bodyMeta.fontSize,
    lineHeight: typography.bodyMeta.lineHeight,
  } as const;

  const countText = isolateNumeric(localizeDigits(String(commentCount), i18n.language));
  const toggleLabel =
    commentCount > 0
      ? t("postComments.count", { number: countText })
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
  }

  async function setOff(off: boolean) {
    setBusy(true);
    setErrorText(null);
    try {
      await actions.setCommentsOff(postId, off);
      if (off) {
        showUndo({
          message: t("postComments.offDone"),
          restore: () => actions.setCommentsOff(postId, false),
        });
      }
    } catch (error) {
      setErrorText(communityErrorText(t, error));
    } finally {
      setBusy(false);
    }
  }

  const composerError = (error: unknown) =>
    error instanceof CommunityError ? communityErrorText(t, error) : null;

  return (
    <View style={{ gap: spacing[2] }} testID={`post-comments-${postId}`}>
      <View style={styles.row}>
        <ActionButton
          label={open ? t("postComments.close") : toggleLabel}
          onPress={() => setOpen((value) => !value)}
          testID={`post-comments-toggle-${postId}`}
        />
        {commentsOff ? (
          <Text style={meta} testID={`post-comments-off-${postId}`}>
            {t("postComments.off")}
          </Text>
        ) : null}
      </View>

      {open ? (
        <View style={{ gap: spacing[3] }}>
          {isPostOwner ? (
            <View style={styles.row}>
              <ActionButton
                label={commentsOff ? t("postComments.turnOn") : t("postComments.turnOff")}
                disabled={busy}
                onPress={() => void setOff(!commentsOff)}
                testID={`post-comments-switch-${postId}`}
              />
            </View>
          ) : null}

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
            threads.map((thread) => (
              <View key={thread.root.id} style={{ gap: spacing[2] }}>
                <PostCommentItem
                  comment={thread.root}
                  viewer={viewer}
                  isPostOwner={isPostOwner}
                  actions={actions}
                  nowMs={list.updatedAt}
                  {...(canWrite && !viewer.isLimited
                    ? { onReply: () => setReplyTo(thread.root.id) }
                    : {})}
                />
                {thread.replies.map((reply) => (
                  <PostCommentItem
                    key={reply.id}
                    comment={reply}
                    viewer={viewer}
                    isPostOwner={isPostOwner}
                    actions={actions}
                    nowMs={list.updatedAt}
                    isReply
                  />
                ))}
                {replyTo === thread.root.id ? (
                  <View style={{ marginStart: spacing[6] }}>
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
                  </View>
                ) : null}
              </View>
            ))
          )}

          {errorText ? (
            <Text
              accessibilityRole="alert"
              style={[meta, { color: colors.status.danger }]}
            >
              {errorText}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", flexWrap: "wrap" },
  link: { minHeight: 44, justifyContent: "center", alignSelf: "flex-start" },
});
