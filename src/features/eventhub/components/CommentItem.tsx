import { useState } from "react";
import { Text } from "react-native";
import { useTranslation } from "react-i18next";

import { formatRelativeTimeValue, getRelativeTime } from "@/features/events";
import { useMuteActions } from "@/features/mute/queries";
import { LimitAccountSheet } from "@/features/restrictions/components/LimitAccountSheet";
import { ReportSheet } from "@/features/reporting/ReportSheet";
import type { ReportInput } from "@/features/reporting/reasons";
import { CommentRow } from "@/features/social/components/CommentRow";
import type { MenuItem } from "@/features/social/components/MenuSheet";
import { useUndoToast } from "@/features/undo/use-undo-toast";
import { confirmDialog } from "@/lib/dialogs";
import { useTheme, nativeFontFamily } from "@/theme";

import { areaCityName } from "../area";
import { isDeletedAccountComment } from "../deleted-account";
import { isPinnedNote } from "../threads";
import type { HubActions } from "../queries";
import { HubError, type HubAuthor, type HubComment, type HubRole } from "../types";
import { RemoveReasons } from "./RemoveReasons";

export interface CommentViewer {
  userId: string | null;
  /** Signed in with an account (not an anonymous session). */
  isAccount: boolean;
  isModerator: boolean;
  /** May remove any comment (`comments.delete`, admins). */
  canDelete?: boolean;
  /** May limit the author's account (`accounts.restrict`, migration 0054). */
  canRestrict?: boolean;
  /** May also suspend it (`accounts.suspend`). */
  canSuspend?: boolean;
  /** May pin one comment to the top of the hub (`hubs.feature`, 0059). */
  canPin?: boolean;
  /** May bring back a removed comment (`content.restore`, 0053): sees it
   * dimmed, with Undo. */
  canRestore?: boolean;
}

/** Pin and unpin (migration 0059), for viewers with `canPin`. */
export interface PinActions {
  pin: (commentId: string) => Promise<void>;
  unpin: (commentId: string) => Promise<void>;
}

interface CommentItemProps {
  comment: HubComment;
  author: HubAuthor | undefined;
  roles: readonly HubRole[] | undefined;
  viewer: CommentViewer;
  helped: boolean;
  /** The viewer reported this comment earlier (read from the server, so it
   * survives a restart) and has not withdrawn the report. */
  flagged?: boolean;
  /** Clock for the relative time (UTC ms), from the thread query. */
  nowMs: number;
  actions: HubActions;
  /** Reply handler; omitted for replies (the thread takes the reply). */
  onReply?: () => void;
  isReply?: boolean;
  /** The viewer follows the author: a small "Following" mark. */
  isFollowing?: boolean;
  pinActions?: PinActions;
}

type Mode = "idle" | "reporting" | "adminRemove" | "limiting";

const NO_AUTHOR = { name: "", username: null, avatarPath: null, roles: [] };

/**
 * One Event hub comment, drawn with the shared `CommentRow`: the heart is
 * the comment's Helpful mark (same counts, same badges; review note 4.4),
 * and Pin, Mute, Report, Delete, Limit, Hide and Remove live in its "..."
 * sheet, the way each viewer may use them.
 */
export function CommentItem({
  comment,
  author,
  roles,
  viewer,
  helped,
  flagged = false,
  nowMs,
  actions,
  onReply,
  isReply = false,
  isFollowing = false,
  pinActions,
}: CommentItemProps) {
  const { t, i18n } = useTranslation();
  const { colors, typography } = useTheme();
  const locale = i18n.language;
  const [mode, setMode] = useState<Mode>("idle");
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<
    "actionError" | "flagLimit" | "restricted" | null
  >(null);
  const [reported, setReported] = useState(false);
  const [withdrawn, setWithdrawn] = useState(false);
  const [undoFailed, setUndoFailed] = useState(false);
  const showUndo = useUndoToast();
  const muteActions = useMuteActions();

  const meta = {
    color: colors.text.secondary,
    fontSize: typography.bodyMeta.fontSize,
    fontFamily: nativeFontFamily(typography.bodyMeta),
    lineHeight: typography.bodyMeta.lineHeight,
  } as const;

  if (isDeletedAccountComment(comment)) {
    // The author deleted their account: no photo, name or link, no actions.
    return (
      <CommentRow
        id={comment.id}
        author={NO_AUTHOR}
        body=""
        timeText=""
        isReply={isReply}
        placeholder={{
          text: t("eventHub.thread.deletedAccount"),
          testID: `comment-deleted-account-${comment.id}`,
        }}
      />
    );
  }
  if (comment.status === "removed") {
    // An admin took the text down (the server wiped it; it is never shown).
    // Readers: a quiet row that keeps the slot so the replies under it still
    // read in order; no author, no actions. Whoever can undo a removal: the
    // same row marked "Removed", with Undo.
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
        author={NO_AUTHOR}
        body=""
        timeText=""
        isReply={isReply}
        placeholder={
          viewer.canRestore
            ? {
                text: t("eventHub.thread.removedByModerator"),
                testID: `comment-removed-${comment.id}`,
                label: t("eventHub.thread.removedLabel"),
                action: {
                  label: t("eventHub.thread.undoRemove"),
                  accessibilityLabel: t("eventHub.thread.undoRemoveA11y"),
                  onPress: () => void undoRemoval(),
                  disabled: busy,
                },
              }
            : {
                text: t("eventHub.thread.removed"),
                testID: `comment-removed-${comment.id}`,
              }
        }
        footer={
          undoFailed ? (
            <Text
              style={[meta, { color: colors.status.danger }]}
              accessibilityLiveRegion="polite"
              testID={`comment-undo-error-${comment.id}`}
            >
              {t("snackbar.undoFailed")}
            </Text>
          ) : null
        }
      />
    );
  }

  const isOwn = viewer.userId !== null && comment.userId === viewer.userId;
  // The server refuses to limit an admin; do not even offer it. The private
  // admin rank (migration 0060) is invisible here by design, so for such an
  // author the row shows and the server's "can't be limited" answer is what
  // the moderator sees.
  const authorIsAdmin = (roles ?? []).some(
    (r) => r.role === "official" || r.role === "moderator",
  );
  const isPending = comment.status === "pending";
  const isVisible = comment.status === "visible";
  const isPinned = !isReply && isPinnedNote(comment);
  const canPin =
    viewer.canPin === true && pinActions !== undefined && !isReply && isVisible;
  const name = author?.displayName ?? t("eventHub.thread.anonymous");
  const city = areaCityName(comment.areaGeohash, locale);

  const relative = getRelativeTime(comment.createdAt, nowMs);
  const timeText =
    relative.unit === "justNow"
      ? t("events.relativeTime.justNow")
      : t(`events.relativeTime.${relative.unit}`, {
          value: formatRelativeTimeValue(relative.value, locale),
        });

  async function sendReport({ reason, note }: ReportInput) {
    await actions.flag(comment.id, reason, note);
    setReported(true);
    setWithdrawn(false);
  }

  function reportErrorText(error: unknown): string {
    return t(
      error instanceof HubError && error.code === "flag_limit"
        ? "eventHub.thread.flagLimit"
        : error instanceof HubError && error.code === "restricted"
          ? "eventHub.thread.restricted"
          : "eventHub.thread.actionError",
    );
  }

  async function run(action: () => Promise<void>): Promise<boolean> {
    setBusy(true);
    setErrorKey(null);
    try {
      await action();
      return true;
    } catch (error) {
      setErrorKey(
        error instanceof HubError && error.code === "flag_limit"
          ? "flagLimit"
          : error instanceof HubError && error.code === "restricted"
            ? "restricted"
            : "actionError",
      );
      return false;
    } finally {
      setBusy(false);
    }
  }

  /** No confirmation: the server deletes at once and the snackbar's Undo (8 s)
   * or the Profile's "Recently deleted" (24 h) brings the comment back. */
  async function deleteOwn() {
    const ok = await run(() => actions.remove(comment.id));
    if (ok) {
      showUndo({
        message: t("snackbar.commentDeleted"),
        restore: () => actions.restore(comment.id),
      });
    }
  }

  /** Mute the author (0061): quiet, for me only; the snackbar offers Undo. */
  async function muteAuthor() {
    const authorId = comment.userId;
    if (authorId === null) {
      return;
    }
    const ok = await run(() => muteActions.mute(authorId));
    if (ok) {
      showUndo({
        message: t("community.mute.snackbarMuted", { name }),
        restore: () => muteActions.unmute(authorId),
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

  async function withdrawReport() {
    const ok = await run(() => actions.withdrawFlag(comment.id));
    if (ok) {
      setWithdrawn(true);
    }
  }

  const isReported = (reported || flagged) && !withdrawn;
  const canHelp = viewer.isAccount && !isOwn && isVisible;

  // The "..." rows, in the order of the mockup: the team's pin first, then
  // what everyone may do, my own Delete, and moderators' actions, the
  // destructive ones last.
  const items: MenuItem[] = [];
  if (canPin && pinActions) {
    items.push({
      key: "pin",
      icon: "pin-outline",
      label: isPinned ? t("eventHub.pin.unpin") : t("eventHub.pin.pin"),
      detail: isPinned ? undefined : t("social.menu.pinDetail"),
      badge: t("social.menu.officialOnly"),
      onPress: () =>
        void run(() =>
          isPinned ? pinActions.unpin(comment.id) : pinActions.pin(comment.id),
        ),
      testID: `${isPinned ? "unpin" : "pin"}-${comment.id}`,
    });
  }
  if (viewer.isModerator && isPending) {
    items.push({
      key: "approve",
      icon: "checkmark-circle-outline",
      label: t("eventHub.thread.approve"),
      badge: t("social.menu.moderatorsOnly"),
      onPress: () => void run(() => actions.moderate(comment.id, "approve")),
      testID: `approve-${comment.id}`,
    });
  }
  if (!isOwn && viewer.userId !== null && comment.userId !== null) {
    items.push({
      key: "mute",
      icon: "volume-mute-outline",
      label: t("social.menu.mute", { name }),
      detail: t("social.menu.muteDetail"),
      disabled: busy,
      onPress: () => void muteAuthor(),
      testID: `mute-${comment.id}`,
    });
  }
  // A withdrawn report cannot be raised again (the server keeps the row).
  if (!isOwn && isVisible && !isReported && !withdrawn && !flagged) {
    items.push({
      key: "report",
      icon: "flag-outline",
      label: t("eventHub.thread.report"),
      detail: t("social.menu.reportDetail"),
      onPress: () => setMode("reporting"),
      testID: `report-${comment.id}`,
    });
  }
  if (!isOwn && isReported) {
    items.push({
      key: "withdraw",
      icon: "arrow-undo-outline",
      label: t("eventHub.thread.withdrawReport"),
      disabled: busy,
      onPress: () => void withdrawReport(),
      testID: `withdraw-report-${comment.id}`,
    });
  }
  if (isOwn && comment.status !== "hidden") {
    items.push({
      key: "delete",
      icon: "trash-outline",
      label: t("eventHub.thread.delete"),
      detail: t("social.menu.deleteDetail"),
      danger: true,
      disabled: busy,
      onPress: () => void deleteOwn(),
      testID: `delete-${comment.id}`,
    });
  }
  if (viewer.canRestrict && !isOwn && comment.userId !== null && !authorIsAdmin) {
    items.push({
      key: "limit",
      icon: "hand-left-outline",
      label: t("restrictions.admin.action"),
      badge: t("social.menu.moderatorsOnly"),
      danger: true,
      onPress: () => setMode("limiting"),
      testID: `limit-${comment.id}`,
    });
  }
  if (viewer.isModerator && isPending) {
    items.push({
      key: "hide",
      icon: "eye-off-outline",
      label: t("eventHub.thread.hide"),
      badge: t("social.menu.moderatorsOnly"),
      danger: true,
      disabled: busy,
      onPress: () => void hide(),
      testID: `hide-${comment.id}`,
    });
  }
  if (viewer.canDelete && !isOwn && comment.status !== "hidden") {
    items.push({
      key: "remove",
      icon: "trash-outline",
      label: t("eventHub.thread.remove"),
      detail: t("eventHub.thread.removeConfirmMessage"),
      badge: t("social.menu.moderatorsOnly"),
      danger: true,
      onPress: () => setMode("adminRemove"),
      testID: `remove-${comment.id}`,
    });
  }

  const footer = (
    <>
      {mode === "adminRemove" ? (
        <RemoveReasons
          testID={`remove-reasons-${comment.id}`}
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
      {!isOwn && isReported ? (
        <Text style={meta} testID={`comment-reported-${comment.id}`}>
          {t("eventHub.thread.reported")}
        </Text>
      ) : null}
      {!isOwn && withdrawn ? (
        <Text style={meta} testID={`report-withdrawn-${comment.id}`}>
          {t("eventHub.thread.reportWithdrawn")}
        </Text>
      ) : null}
      {errorKey ? (
        <Text
          style={[meta, { color: colors.status.danger }]}
          accessibilityLiveRegion="polite"
          testID={`comment-error-${comment.id}`}
        >
          {t(`eventHub.thread.${errorKey}`)}
        </Text>
      ) : null}
      {mode === "reporting" ? (
        <ReportSheet
          kind="comment"
          testID={`report-sheet-${comment.id}`}
          onSubmit={sendReport}
          onClose={() => setMode("idle")}
          errorText={reportErrorText}
        />
      ) : null}
      {mode === "limiting" && comment.userId !== null ? (
        <LimitAccountSheet
          target={{ userId: comment.userId, name }}
          canSuspend={viewer.canSuspend === true}
          onClose={() => setMode("idle")}
        />
      ) : null}
    </>
  );

  return (
    <CommentRow
      id={comment.id}
      author={{
        name,
        username: author?.username ?? null,
        avatarPath: author?.avatarPath ?? null,
        roles,
      }}
      body={comment.body}
      timeText={timeText}
      meta={city ? t("eventHub.thread.feltNear", { city }) : null}
      isReply={isReply}
      pinned={isPinned}
      following={isFollowing}
      pendingText={
        isPending ? (isOwn ? t("social.pendingOwn") : t("eventHub.thread.pending")) : null
      }
      heart={
        isVisible
          ? {
              count: comment.helpfulCount,
              liked: helped,
              disabled: busy,
              onToggle: canHelp
                ? () => void run(() => actions.setHelpful(comment.id, !helped))
                : undefined,
            }
          : null
      }
      onReply={isVisible ? onReply : undefined}
      menuItems={items}
      footer={footer}
    />
  );
}
