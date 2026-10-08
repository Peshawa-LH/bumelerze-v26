import { useRouter } from "expo-router";
import { useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { Avatar, getAvatarUrl } from "@/features/account";
import { profileHref } from "@/features/community/routes";
import {
  formatRelativeTimeValue,
  getRelativeTime,
  isolateNumeric,
} from "@/features/events";
import { useMuteActions } from "@/features/mute/queries";
import { LimitAccountButton } from "@/features/restrictions/components/LimitAccountButton";
import { useUndoToast } from "@/features/undo/use-undo-toast";
import { ReportSheet } from "@/features/reporting/ReportSheet";
import type { ReportInput } from "@/features/reporting/reasons";
import { confirmDialog } from "@/lib/dialogs";
import { localizeDigits } from "@/lib/format-numbers";
import { useTheme } from "@/theme";

import { areaCityName } from "../area";
import { isDeletedAccountComment } from "../deleted-account";
import type { HubActions } from "../queries";
import { HubError, type HubAuthor, type HubComment, type HubRole } from "../types";
import { ActionButton } from "./ActionButton";
import { RemoveReasons } from "./RemoveReasons";
import { RoleMark } from "./RoleMark";

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
  /** Reply button handler; omitted for replies (the thread takes the reply). */
  onReply?: () => void;
  isReply?: boolean;
  /** The viewer follows the author: a small "Following" mark. */
  isFollowing?: boolean;
}

type Mode = "idle" | "reporting" | "adminRemove";

/** One comment: author, role mark, time, area, text and its actions. */
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
}: CommentItemProps) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { colors, typography, spacing } = useTheme();
  const locale = i18n.language;
  const [mode, setMode] = useState<Mode>("idle");
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<
    "actionError" | "flagLimit" | "restricted" | null
  >(null);
  const [reported, setReported] = useState(false);
  const [withdrawn, setWithdrawn] = useState(false);
  const showUndo = useUndoToast();
  const muteActions = useMuteActions();

  const isOwn = viewer.userId !== null && comment.userId === viewer.userId;
  // The server refuses to limit an admin; do not even offer it. The private
  // admin rank (migration 0060) is invisible here by design, so for such an
  // author the button shows and the server's "can't be limited" answer is
  // what the moderator sees.
  const authorIsAdmin = (roles ?? []).some(
    (r) => r.role === "official" || r.role === "moderator",
  );
  const isPending = comment.status === "pending";
  const isVisible = comment.status === "visible";
  const name = author?.displayName ?? t("eventHub.thread.anonymous");
  const city = areaCityName(comment.areaGeohash, locale);

  const relative = getRelativeTime(comment.createdAt, nowMs);
  const timeText =
    relative.unit === "justNow"
      ? t("events.relativeTime.justNow")
      : t(`events.relativeTime.${relative.unit}`, {
          value: formatRelativeTimeValue(relative.value, locale),
        });

  /** The reporting sheet's send: the server decides, the sheet words a failure. */
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

  const meta = {
    color: colors.text.secondary,
    fontSize: typography.bodyMeta.fontSize,
    lineHeight: typography.bodyMeta.lineHeight,
  } as const;

  const isReported = (reported || flagged) && !withdrawn;
  const canHelp = viewer.isAccount && !isOwn && isVisible;
  const helpfulCountText = isolateNumeric(
    localizeDigits(String(comment.helpfulCount), locale),
  );
  const helpfulLabel =
    comment.helpfulCount > 0
      ? t("eventHub.thread.helpfulCount", { number: helpfulCountText })
      : t("eventHub.thread.helpful");

  if (isDeletedAccountComment(comment)) {
    // The author deleted their account: no photo, name or link, no actions.
    return (
      <View
        testID={`comment-${comment.id}`}
        style={isReply ? { marginStart: spacing[6] } : null}
      >
        <Text
          style={[meta, { fontStyle: "italic" }]}
          testID={`comment-deleted-account-${comment.id}`}
        >
          {t("eventHub.thread.deletedAccount")}
        </Text>
      </View>
    );
  }

  if (comment.status === "removed") {
    // An admin took the text down. Keep the slot so the replies under it
    // still read in order; no author, no text, no actions.
    return (
      <View
        testID={`comment-${comment.id}`}
        style={isReply ? { marginStart: spacing[6] } : null}
      >
        <Text
          style={[meta, { fontStyle: "italic" }]}
          testID={`comment-removed-${comment.id}`}
        >
          {t("eventHub.thread.removed")}
        </Text>
      </View>
    );
  }

  const username = author?.username ?? null;
  const openProfile = username ? () => router.push(profileHref(username)) : null;
  const avatar = (
    <Avatar
      uri={getAvatarUrl(author?.avatarPath)}
      name={author?.displayName ?? null}
      size={isReply ? 28 : 36}
      testID={`comment-avatar-${comment.id}`}
    />
  );
  const nameText = (
    <Text
      style={{
        color: colors.text.primary,
        fontSize: typography.bodyDefault.fontSize,
        lineHeight: typography.bodyDefault.lineHeight,
        fontWeight: "600",
      }}
    >
      {name}
    </Text>
  );

  return (
    <View
      testID={`comment-${comment.id}`}
      style={[
        styles.row,
        { gap: spacing[3] },
        isReply ? { marginStart: spacing[6] } : null,
      ]}
    >
      {openProfile ? (
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={t("community.openProfile", { name })}
          hitSlop={isReply ? 8 : 4}
          onPress={openProfile}
          testID={`comment-avatar-link-${comment.id}`}
        >
          {avatar}
        </Pressable>
      ) : (
        avatar
      )}
      <View style={[styles.content, { gap: spacing[1] }]}>
        <View style={[styles.headerRow, { gap: spacing[2] }]}>
          {openProfile ? (
            <Pressable
              accessibilityRole="link"
              accessibilityLabel={t("community.openProfile", { name })}
              hitSlop={{ top: 10, bottom: 10 }}
              onPress={openProfile}
              testID={`comment-name-link-${comment.id}`}
            >
              {nameText}
            </Pressable>
          ) : (
            nameText
          )}
          <RoleMark roles={roles} />
          {isFollowing ? (
            <Text style={meta} testID={`comment-following-${comment.id}`}>
              {t("eventHub.thread.following")}
            </Text>
          ) : null}
          <Text style={meta}>{timeText}</Text>
        </View>

        {city ? (
          <Text style={meta}>{t("eventHub.thread.feltNear", { city })}</Text>
        ) : null}

        <Text
          style={{
            color: colors.text.primary,
            fontSize: typography.bodyDefault.fontSize,
            lineHeight: typography.bodyDefault.lineHeight,
            textAlign: "auto",
            alignSelf: "stretch",
            flexShrink: 1,
            ...WRAP_ANYWHERE,
          }}
        >
          {comment.body}
        </Text>

        {isPending ? (
          <Text style={[meta, { fontStyle: "italic" }]}>
            {t("eventHub.thread.pending")}
          </Text>
        ) : null}

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
        ) : (
          <View style={[styles.actions, { gap: spacing[1] }]}>
            {isVisible && onReply ? (
              <ActionButton label={t("eventHub.thread.reply")} onPress={onReply} />
            ) : null}
            {canHelp ? (
              <ActionButton
                label={helpfulLabel}
                selected={helped}
                disabled={busy}
                onPress={() => void run(() => actions.setHelpful(comment.id, !helped))}
              />
            ) : comment.helpfulCount > 0 ? (
              <Text style={[meta, styles.staticAction]}>{helpfulLabel}</Text>
            ) : null}
            {!isOwn && isVisible && !isReported && !withdrawn && !flagged ? (
              <ActionButton
                label={t("eventHub.thread.report")}
                onPress={() => setMode("reporting")}
              />
            ) : null}
            {!isOwn && isReported ? (
              <>
                <Text style={[meta, styles.staticAction]}>
                  {t("eventHub.thread.reported")}
                </Text>
                <ActionButton
                  label={t("eventHub.thread.withdrawReport")}
                  disabled={busy}
                  onPress={async () => {
                    const ok = await run(() => actions.withdrawFlag(comment.id));
                    if (ok) {
                      setWithdrawn(true);
                    }
                  }}
                  testID={`withdraw-report-${comment.id}`}
                />
              </>
            ) : null}
            {!isOwn && withdrawn ? (
              <Text
                style={[meta, styles.staticAction]}
                testID={`report-withdrawn-${comment.id}`}
              >
                {t("eventHub.thread.reportWithdrawn")}
              </Text>
            ) : null}
            {!isOwn && viewer.userId !== null && comment.userId !== null ? (
              <ActionButton
                label={t("eventHub.thread.mute")}
                disabled={busy}
                onPress={() => void muteAuthor()}
                testID={`mute-${comment.id}`}
              />
            ) : null}
            {isOwn && comment.status !== "hidden" ? (
              <ActionButton
                label={t("eventHub.thread.delete")}
                disabled={busy}
                onPress={() => void deleteOwn()}
                testID={`delete-${comment.id}`}
              />
            ) : null}
            {viewer.canDelete && !isOwn && comment.status !== "hidden" ? (
              <ActionButton
                label={t("eventHub.thread.remove")}
                danger
                onPress={() => setMode("adminRemove")}
                testID={`remove-${comment.id}`}
              />
            ) : null}
            {viewer.canRestrict && !isOwn && comment.userId !== null && !authorIsAdmin ? (
              <LimitAccountButton
                target={{ userId: comment.userId, name }}
                canSuspend={viewer.canSuspend === true}
                testID={`limit-${comment.id}`}
              />
            ) : null}
            {viewer.isModerator && isPending ? (
              <>
                <ActionButton
                  label={t("eventHub.thread.approve")}
                  disabled={busy}
                  onPress={() => void run(() => actions.moderate(comment.id, "approve"))}
                />
                <ActionButton
                  label={t("eventHub.thread.hide")}
                  danger
                  disabled={busy}
                  onPress={() => void hide()}
                  testID={`hide-${comment.id}`}
                />
              </>
            ) : null}
          </View>
        )}

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
      </View>
    </View>
  );
}

/** Long comments always wrap inside the column, also in browsers that size a
 * mixed-direction paragraph to its full line (owner screenshot, 2026-10-08):
 * each paragraph takes its own direction, and very long words break. */
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
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  content: {
    flex: 1,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
  },
  staticAction: {
    paddingHorizontal: 8,
  },
});
