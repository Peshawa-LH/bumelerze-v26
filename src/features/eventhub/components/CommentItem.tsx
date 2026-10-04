import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { Avatar, getAvatarUrl } from "@/features/account";
import {
  formatRelativeTimeValue,
  getRelativeTime,
  isolateNumeric,
} from "@/features/events";
import { localizeDigits } from "@/lib/format-numbers";
import { useTheme } from "@/theme";

import { areaCityName } from "../area";
import type { HubActions } from "../queries";
import {
  FLAG_REASONS,
  type FlagReason,
  type HubAuthor,
  type HubComment,
  type HubRole,
} from "../types";
import { RoleMark } from "./RoleMark";

export interface CommentViewer {
  userId: string | null;
  /** Signed in with an account (not an anonymous session). */
  isAccount: boolean;
  isModerator: boolean;
}

interface CommentItemProps {
  comment: HubComment;
  author: HubAuthor | undefined;
  roles: readonly HubRole[] | undefined;
  viewer: CommentViewer;
  helped: boolean;
  /** Clock for the relative time (UTC ms), from the thread query. */
  nowMs: number;
  actions: HubActions;
  /** Reply button handler; omitted for replies (the thread takes the reply). */
  onReply?: () => void;
  isReply?: boolean;
}

type Mode = "idle" | "reporting" | "confirmDelete";

/** One comment: author, role mark, time, area, text and its actions. */
export function CommentItem({
  comment,
  author,
  roles,
  viewer,
  helped,
  nowMs,
  actions,
  onReply,
  isReply = false,
}: CommentItemProps) {
  const { t, i18n } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const locale = i18n.language;
  const [mode, setMode] = useState<Mode>("idle");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [reported, setReported] = useState(false);

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
    setFailed(false);
    try {
      await action();
      return true;
    } catch {
      setFailed(true);
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

  const canHelp = viewer.isAccount && !isOwn && isVisible;
  const helpfulCountText = isolateNumeric(
    localizeDigits(String(comment.helpfulCount), locale),
  );
  const helpfulLabel =
    comment.helpfulCount > 0
      ? t("eventHub.thread.helpfulCount", { number: helpfulCountText })
      : t("eventHub.thread.helpful");

  return (
    <View
      testID={`comment-${comment.id}`}
      style={[
        styles.row,
        { gap: spacing[3] },
        isReply ? { marginStart: spacing[6] } : null,
      ]}
    >
      <Avatar
        uri={getAvatarUrl(author?.avatarPath)}
        name={author?.displayName ?? null}
        size={isReply ? 28 : 36}
        testID={`comment-avatar-${comment.id}`}
      />
      <View style={[styles.content, { gap: spacing[1] }]}>
        <View style={[styles.headerRow, { gap: spacing[2] }]}>
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
          <RoleMark roles={roles} />
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
            {!isOwn && isVisible && !reported ? (
              <ActionButton
                label={t("eventHub.thread.report")}
                onPress={() => setMode("reporting")}
              />
            ) : null}
            {reported ? (
              <Text style={[meta, styles.staticAction]}>
                {t("eventHub.thread.reported")}
              </Text>
            ) : null}
            {isOwn && comment.status !== "hidden" ? (
              <ActionButton
                label={t("eventHub.thread.delete")}
                onPress={() => setMode("confirmDelete")}
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

        {failed ? (
          <Text
            style={[meta, { color: colors.status.danger }]}
            accessibilityLiveRegion="polite"
          >
            {t("eventHub.thread.actionError")}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

interface ActionButtonProps {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  selected?: boolean;
  danger?: boolean;
}

/** Text-link style action, at least 44 px tall. */
function ActionButton({
  label,
  onPress,
  disabled = false,
  selected = false,
  danger = false,
}: ActionButtonProps) {
  const { colors, typography, spacing } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={4}
      style={[styles.action, { paddingHorizontal: spacing[2] }]}
    >
      <Text
        style={{
          color: danger
            ? colors.status.danger
            : disabled
              ? colors.text.tertiary
              : colors.text.link,
          fontSize: typography.bodyMeta.fontSize,
          fontWeight: selected ? "700" : typography.labelButton.fontWeight,
          textDecorationLine: selected ? "underline" : "none",
        }}
      >
        {label}
      </Text>
    </Pressable>
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
  action: {
    minHeight: 44,
    minWidth: 44,
    justifyContent: "center",
    alignItems: "center",
  },
  staticAction: {
    paddingHorizontal: 8,
  },
});
