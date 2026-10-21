import { useState } from "react";
import { Text } from "react-native";
import { useTranslation } from "react-i18next";

import { communityErrorText } from "@/features/community/error-text";
import { RemoveReasons } from "@/features/eventhub/components/RemoveReasons";
import { formatRelativeTimeValue, getRelativeTime } from "@/features/events";
import { useMuteActions } from "@/features/mute/queries";
import { ReportSheet } from "@/features/reporting/ReportSheet";
import type { ReportInput } from "@/features/reporting/reasons";
import { CommentRow } from "@/features/social/components/CommentRow";
import type { MenuItem } from "@/features/social/components/MenuSheet";
import type { LikeState } from "@/features/social/transport";
import { useUndoToast } from "@/features/undo/use-undo-toast";
import { confirmDialog } from "@/lib/dialogs";
import { useTheme, nativeFontFamily, READING_START } from "@/theme";
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
  /** A real account: may give hearts (migration 0065). */
  isAccount?: boolean;
  /** `content.restore` (the official account): sees a removed comment
   * dimmed, with Undo. */
  canRestore?: boolean;
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
  /** The comment's hearts (migration 0065); none known yet when left out. */
  like?: LikeState;
  /** Gives or takes back my heart. */
  onLike?: (like: boolean) => Promise<unknown>;
}

type Mode = "idle" | "reporting" | "adminRemove";

const NO_AUTHOR = { name: "", username: null, avatarPath: null, roles: [] };

/** One comment under a post, drawn with the SAME `CommentRow` as the Event
 * hub (review note 5.1): heart, Reply, and Delete, Mute, Report, Hide and
 * Remove in its "..." sheet. */
export function PostCommentItem({
  comment,
  viewer,
  isPostOwner,
  actions,
  nowMs,
  isReply = false,
  onReply,
  like,
  onLike,
}: PostCommentItemProps) {
  const { t, i18n } = useTranslation();
  const { colors, typography } = useTheme();
  const [mode, setMode] = useState<Mode>("idle");
  const [busy, setBusy] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [reported, setReported] = useState(false);
  const [undoFailed, setUndoFailed] = useState(false);
  const showUndo = useUndoToast();
  const muteActions = useMuteActions();

  const meta = {
    color: colors.text.secondary,
    fontSize: typography.bodyMeta.fontSize,
    fontFamily: nativeFontFamily(typography.bodyMeta),
    ...READING_START,
    lineHeight: typography.bodyMeta.lineHeight,
  } as const;

  if (comment.status === "removed" || isDeletedAccountPostComment(comment)) {
    // Keeps the slot so the replies under it still read in order. A removed
    // comment's text is wiped by the server and never shown; whoever can
    // undo a removal gets the row marked "Removed", with Undo.
    const removed = comment.status === "removed";
    const undoRemoval = async () => {
      setBusy(true);
      setUndoFailed(false);
      try {
        await actions.adminRestore(comment.id);
      } catch {
        setUndoFailed(true);
      } finally {
        setBusy(false);
      }
    };
    return (
      <CommentRow
        id={comment.id}
        testIDPrefix="post-comment"
        author={NO_AUTHOR}
        body=""
        timeText=""
        isReply={isReply}
        placeholder={
          removed && viewer.canRestore
            ? {
                text: t("eventHub.thread.removedByModerator"),
                testID: `post-comment-placeholder-${comment.id}`,
                label: t("eventHub.thread.removedLabel"),
                action: {
                  label: t("eventHub.thread.undoRemove"),
                  accessibilityLabel: t("eventHub.thread.undoRemoveA11y"),
                  onPress: () => void undoRemoval(),
                  disabled: busy,
                },
              }
            : {
                text: removed
                  ? t("eventHub.thread.removed")
                  : t("eventHub.thread.deletedAccount"),
                testID: `post-comment-placeholder-${comment.id}`,
              }
        }
        footer={
          undoFailed ? (
            <Text
              accessibilityRole="alert"
              style={[meta, { color: colors.status.danger }]}
              testID={`post-comment-undo-error-${comment.id}`}
            >
              {t("snackbar.undoFailed")}
            </Text>
          ) : null
        }
      />
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

  const items: MenuItem[] = [];
  if (!isOwn && viewer.userId !== null && comment.userId !== null) {
    items.push({
      key: "mute",
      icon: "volume-mute-outline",
      label: t("social.menu.mute", { name }),
      detail: t("social.menu.muteDetail"),
      disabled: busy,
      onPress: () => void mute(),
      testID: `post-comment-mute-${comment.id}`,
    });
  }
  if (!isOwn && isVisible && viewer.canReport && !reported) {
    items.push({
      key: "report",
      icon: "flag-outline",
      label: t("eventHub.thread.report"),
      detail: t("social.menu.reportDetail"),
      onPress: () => setMode("reporting"),
      testID: `post-comment-report-${comment.id}`,
    });
  }
  if (isOwn || isPostOwner) {
    items.push({
      key: "delete",
      icon: "trash-outline",
      label: t("eventHub.thread.delete"),
      detail: isOwn ? t("social.menu.deleteDetail") : t("social.menu.deleteOnMyPost"),
      danger: true,
      disabled: busy,
      onPress: () => void deleteComment(),
      testID: `post-comment-delete-${comment.id}`,
    });
  }
  if (viewer.isModerator && !isOwn && isVisible) {
    items.push({
      key: "hide",
      icon: "eye-off-outline",
      label: t("eventHub.thread.hide"),
      badge: t("social.menu.moderatorsOnly"),
      danger: true,
      disabled: busy,
      onPress: () => void hide(),
      testID: `post-comment-hide-${comment.id}`,
    });
  }
  if (viewer.canRemove && !isOwn) {
    items.push({
      key: "remove",
      icon: "trash-outline",
      label: t("eventHub.thread.remove"),
      detail: t("eventHub.thread.removeConfirmMessage"),
      badge: t("social.menu.moderatorsOnly"),
      danger: true,
      onPress: () => setMode("adminRemove"),
      testID: `post-comment-remove-${comment.id}`,
    });
  }

  const liked = like?.liked ?? false;
  const canLike =
    viewer.isAccount === true && !isOwn && isVisible && onLike !== undefined;

  return (
    <CommentRow
      id={comment.id}
      testIDPrefix="post-comment"
      author={{
        name,
        username: comment.username,
        avatarPath: comment.avatarPath,
        roles: comment.roles,
      }}
      body={comment.body}
      timeText={timeText}
      isReply={isReply}
      pendingText={comment.status === "pending" ? t("postComments.pending") : null}
      heart={
        isVisible
          ? {
              count: like?.count ?? 0,
              liked,
              disabled: busy,
              onToggle: canLike ? () => void run(() => onLike(!liked)) : undefined,
            }
          : null
      }
      onReply={isVisible ? onReply : undefined}
      menuItems={items}
      footer={
        <>
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
          ) : null}
          {reported ? (
            <Text style={meta} testID={`post-comment-reported-${comment.id}`}>
              {t("eventHub.thread.reported")}
            </Text>
          ) : null}
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
        </>
      }
    />
  );
}
