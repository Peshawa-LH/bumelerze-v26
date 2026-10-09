import { useRouter } from "expo-router";
import { useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { Avatar, getAvatarUrl } from "@/features/account";
import { communityErrorText } from "@/features/community/error-text";
import { profileHref } from "@/features/community/routes";
import { ActionButton } from "@/features/eventhub/components/ActionButton";
import { RemoveReasons } from "@/features/eventhub/components/RemoveReasons";
import { RoleMark } from "@/features/eventhub/components/RoleMark";
import { formatRelativeTimeValue, getRelativeTime } from "@/features/events";
import { MentionText } from "@/features/mentions/components/MentionText";
import { useMuteActions } from "@/features/mute/queries";
import { ReportSheet } from "@/features/reporting/ReportSheet";
import type { ReportInput } from "@/features/reporting/reasons";
import { useUndoToast } from "@/features/undo/use-undo-toast";
import { confirmDialog } from "@/lib/dialogs";
import { useTheme } from "@/theme";
import type { PostCommentActions } from "../queries";
import { isDeletedAccountPostComment } from "../threads";
import type { PostComment } from "../types";

export interface PostCommentViewer {
  userId: string | null;
  /** May report (signed in, guests too). */
  canReport: boolean;
  /** `comments.moderate`: Hide. */
  isModerator: boolean;
  /** `comments.delete` (the official account): Remove. */
  canRemove: boolean;
}

interface PostCommentItemProps {
  comment: PostComment;
  viewer: PostCommentViewer;
  /** The viewer wrote the post: may delete anybody's comment on it. */
  isPostOwner: boolean;
  actions: PostCommentActions;
  /** Clock for the relative time (UTC ms). */
  nowMs: number;
  isReply?: boolean;
  /** Reply handler; omitted when the viewer cannot comment. */
  onReply?: () => void;
}

type Mode = "idle" | "reporting" | "adminRemove";

/** One comment under a post: photo, name, rank mark, time, the text with
 * @mention links, and the actions that fit the viewer. */
export function PostCommentItem({
  comment,
  viewer,
  isPostOwner,
  actions,
  nowMs,
  isReply = false,
  onReply,
}: PostCommentItemProps) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { colors, typography, spacing } = useTheme();
  const [mode, setMode] = useState<Mode>("idle");
  const [busy, setBusy] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [reported, setReported] = useState(false);
  const showUndo = useUndoToast();
  const muteActions = useMuteActions();

  const meta = {
    color: colors.text.secondary,
    fontSize: typography.bodyMeta.fontSize,
    lineHeight: typography.bodyMeta.lineHeight,
  } as const;
  const indent = isReply ? { marginStart: spacing[6] } : null;

  if (comment.status === "removed" || isDeletedAccountPostComment(comment)) {
    // Keeps the slot so the replies under it still read in order.
    return (
      <View testID={`post-comment-${comment.id}`} style={indent}>
        <Text
          style={[meta, { fontStyle: "italic" }]}
          testID={`post-comment-placeholder-${comment.id}`}
        >
          {comment.status === "removed"
            ? t("eventHub.thread.removed")
            : t("eventHub.thread.deletedAccount")}
        </Text>
      </View>
    );
  }

  const isOwn = viewer.userId !== null && comment.userId === viewer.userId;
  const isVisible = comment.status === "visible";
  const name = comment.displayName ?? t("eventHub.thread.anonymous");
  const relative = getRelativeTime(comment.createdAt, nowMs);
  const timeText =
    relative.unit === "justNow"
      ? t("events.relativeTime.justNow")
      : t(`events.relativeTime.${relative.unit}`, {
          value: formatRelativeTimeValue(relative.value, i18n.language),
        });

  async function run(action: () => Promise<unknown>): Promise<boolean> {
    setBusy(true);
    setErrorText(null);
    try {
      await action();
      return true;
    } catch (error) {
      setErrorText(communityErrorText(t, error));
      return false;
    } finally {
      setBusy(false);
    }
  }

  /** No confirmation: the server deletes at once; Undo (8 s) brings it back
   * (and, for my own comment, "Recently deleted" for 24 hours). */
  async function deleteComment() {
    const ok = await run(() => actions.remove(comment.id));
    if (ok) {
      showUndo({
        message: t("snackbar.commentDeleted"),
        restore: () => actions.restore(comment.id),
      });
    }
  }

  async function hide() {
    const ok = await run(() => actions.moderate(comment.id, "hide"));
    if (ok) {
      showUndo({
        message: t("snackbar.commentHidden"),
        restore: () => actions.adminRestore(comment.id),
        admin: true,
      });
    }
  }

  async function mute() {
    const authorId = comment.userId;
    if (authorId === null) return;
    const ok = await run(() => muteActions.mute(authorId));
    if (ok) {
      showUndo({
        message: t("community.mute.snackbarMuted", { name }),
        restore: () => muteActions.unmute(authorId),
      });
    }
  }

  async function sendReport({ reason, note }: ReportInput) {
    await actions.report(comment.id, reason, note);
    setReported(true);
  }

  const openProfile = comment.username
    ? () => router.push(profileHref(comment.username as string))
    : null;
  const avatar = (
    <Avatar
      uri={getAvatarUrl(comment.avatarPath)}
      name={comment.displayName}
      size={isReply ? 28 : 32}
    />
  );

  return (
    <View
      testID={`post-comment-${comment.id}`}
      style={[styles.row, { gap: spacing[2] }, indent]}
    >
      {openProfile ? (
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={t("community.openProfile", { name })}
          onPress={openProfile}
          hitSlop={8}
        >
          {avatar}
        </Pressable>
      ) : (
        avatar
      )}
      <View style={[styles.content, { gap: spacing[1] }]}>
        <View style={[styles.header, { gap: spacing[2] }]}>
          {openProfile ? (
            <Pressable
              accessibilityRole="link"
              accessibilityLabel={t("community.openProfile", { name })}
              onPress={openProfile}
              hitSlop={{ top: 10, bottom: 10 }}
              testID={`post-comment-name-${comment.id}`}
            >
              <Text style={[styles.name, { color: colors.text.primary }]}>{name}</Text>
            </Pressable>
          ) : (
            <Text style={[styles.name, { color: colors.text.primary }]}>{name}</Text>
          )}
          <RoleMark roles={comment.roles} explain />
          <Text style={meta}>{timeText}</Text>
        </View>

        <MentionText
          text={comment.body}
          testID={`post-comment-body-${comment.id}`}
          style={{
            color: colors.text.primary,
            fontSize: typography.bodyDefault.fontSize,
            lineHeight: typography.bodyDefault.lineHeight,
            textAlign: "auto",
            alignSelf: "stretch",
            flexShrink: 1,
            ...WRAP_ANYWHERE,
          }}
        />

        {comment.status === "pending" ? (
          <Text
            style={[meta, { fontStyle: "italic" }]}
            testID={`post-comment-pending-${comment.id}`}
          >
            {t("postComments.pending")}
          </Text>
        ) : null}

        {mode === "adminRemove" ? (
          <RemoveReasons
            disabled={busy}
            onCancel={() => setMode("idle")}
            onSelect={(reason) =>
              confirmDialog({
                title: t("eventHub.thread.removeConfirmTitle"),
                message: t("eventHub.thread.removeConfirmMessage"),
                confirmLabel: t("eventHub.thread.remove"),
                cancelLabel: t("eventHub.thread.cancel"),
                destructive: true,
                onConfirm: () =>
                  void run(() => actions.adminRemove(comment.id, reason)).then((ok) => {
                    if (ok) {
                      setMode("idle");
                      showUndo({
                        message: t("snackbar.commentRemoved"),
                        restore: () => actions.adminRestore(comment.id),
                        admin: true,
                      });
                    }
                  }),
              })
            }
          />
        ) : (
          <View style={styles.actions}>
            {isVisible && onReply ? (
              <ActionButton
                label={t("eventHub.thread.reply")}
                onPress={onReply}
                testID={`post-comment-reply-${comment.id}`}
              />
            ) : null}
            {!isOwn && isVisible && viewer.canReport && !reported ? (
              <ActionButton
                label={t("eventHub.thread.report")}
                onPress={() => setMode("reporting")}
                testID={`post-comment-report-${comment.id}`}
              />
            ) : null}
            {reported ? (
              <Text
                style={[meta, styles.staticAction]}
                testID={`post-comment-reported-${comment.id}`}
              >
                {t("eventHub.thread.reported")}
              </Text>
            ) : null}
            {!isOwn && viewer.userId !== null && comment.userId !== null ? (
              <ActionButton
                label={t("eventHub.thread.mute")}
                disabled={busy}
                onPress={() => void mute()}
                testID={`post-comment-mute-${comment.id}`}
              />
            ) : null}
            {isOwn || isPostOwner ? (
              <ActionButton
                label={t("eventHub.thread.delete")}
                danger={!isOwn}
                disabled={busy}
                onPress={() => void deleteComment()}
                testID={`post-comment-delete-${comment.id}`}
              />
            ) : null}
            {viewer.isModerator && !isOwn && isVisible ? (
              <ActionButton
                label={t("eventHub.thread.hide")}
                danger
                disabled={busy}
                onPress={() => void hide()}
                testID={`post-comment-hide-${comment.id}`}
              />
            ) : null}
            {viewer.canRemove && !isOwn ? (
              <ActionButton
                label={t("eventHub.thread.remove")}
                danger
                onPress={() => setMode("adminRemove")}
                testID={`post-comment-remove-${comment.id}`}
              />
            ) : null}
          </View>
        )}

        {errorText ? (
          <Text
            accessibilityRole="alert"
            style={[meta, { color: colors.status.danger }]}
            testID={`post-comment-error-${comment.id}`}
          >
            {errorText}
          </Text>
        ) : null}

        {mode === "reporting" ? (
          <ReportSheet
            kind="comment"
            testID={`post-comment-report-sheet-${comment.id}`}
            onSubmit={sendReport}
            onClose={() => setMode("idle")}
            errorText={(error) => communityErrorText(t, error)}
          />
        ) : null}
      </View>
    </View>
  );
}

/** Long comments always wrap inside the column (as in the Event hub). */
const WRAP_ANYWHERE = (
  Platform.OS === "web"
    ? {
        overflowWrap: "anywhere",
        wordBreak: "break-word",
        unicodeBidi: "plaintext",
        maxWidth: "100%",
      }
    : {}
) as object;

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "flex-start" },
  content: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", flexWrap: "wrap" },
  name: { fontWeight: "600" },
  actions: { flexDirection: "row", alignItems: "center", flexWrap: "wrap" },
  staticAction: { paddingHorizontal: 8 },
});
