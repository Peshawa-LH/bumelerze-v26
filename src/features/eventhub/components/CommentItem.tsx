import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { Avatar, getAvatarUrl } from "@/features/account";
import { profileHref } from "@/features/community/routes";
import {
  formatRelativeTimeValue,
  getRelativeTime,
  isolateNumeric,
} from "@/features/events";
import { confirmDialog } from "@/lib/dialogs";
import { localizeDigits } from "@/lib/format-numbers";
import { useTheme } from "@/theme";

import { areaCityName } from "../area";
import type { HubActions } from "../queries";
import {
  FLAG_REASONS,
  HubError,
  type FlagReason,
  type HubAuthor,
  type HubComment,
  type HubRole,
} from "../types";
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

type Mode = "idle" | "reporting" | "confirmDelete" | "adminRemove";

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
  const [errorKey, setErrorKey] = useState<"actionError" | "flagLimit" | null>(null);
  const [reported, setReported] = useState(false);
  const [withdrawn, setWithdrawn] = useState(false);

  const isOwn = viewer.userId !== null && comment.userId === viewer.userId;
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
          : "actionError",
      );
      return false;
    } finally {
      setBusy(false);
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
          }}
        >
          {comment.body}
        </Text>

        {isPending ? (
          <Text style={[meta, { fontStyle: "italic" }]}>
            {t("eventHub.thread.pending")}
          </Text>
        ) : null}

        {mode === "reporting" ? (
          <View style={{ gap: spacing[1] }} testID={`reasons-${comment.id}`}>
            <Text style={meta}>{t("eventHub.thread.reportTitle")}</Text>
            <View style={[styles.actions, { gap: spacing[1] }]}>
              {FLAG_REASONS.map((reason: FlagReason) => (
                <ActionButton
                  key={reason}
                  label={t(`eventHub.reasons.${reason}`)}
                  disabled={busy}
                  onPress={async () => {
                    const ok = await run(() => actions.flag(comment.id, reason));
                    if (ok) {
                      setReported(true);
                      setWithdrawn(false);
                      setMode("idle");
                    }
                  }}
                />
              ))}
              <ActionButton
                label={t("eventHub.thread.cancel")}
                onPress={() => setMode("idle")}
              />
            </View>
          </View>
        ) : mode === "adminRemove" ? (
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
                    }
                  }),
              })
            }
          />
        ) : mode === "confirmDelete" ? (
          <View style={{ gap: spacing[1] }}>
            <Text style={meta}>{t("eventHub.thread.deleteConfirm")}</Text>
            <View style={[styles.actions, { gap: spacing[1] }]}>
              <ActionButton
                label={t("eventHub.thread.delete")}
                danger
                disabled={busy}
                onPress={async () => {
                  const ok = await run(() => actions.remove(comment.id));
                  if (ok) {
                    setMode("idle");
                  }
                }}
              />
              <ActionButton
                label={t("eventHub.thread.cancel")}
                onPress={() => setMode("idle")}
              />
            </View>
          </View>
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
            {isOwn && comment.status !== "hidden" ? (
              <ActionButton
                label={t("eventHub.thread.delete")}
                onPress={() => setMode("confirmDelete")}
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
                  onPress={() => void run(() => actions.moderate(comment.id, "hide"))}
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
      </View>
    </View>
  );
}

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
