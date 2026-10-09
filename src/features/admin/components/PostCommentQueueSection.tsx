import { useRouter } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { communityErrorText } from "@/features/community/error-text";
import { ProfileLink } from "@/features/community/components/ProfileLink";
import { profileHref } from "@/features/community/routes";
import { formatUsername } from "@/features/community/username";
import { HoldNote } from "@/features/contentfilter/components/HoldNote";
import { useHolds } from "@/features/contentfilter/queries";
import type { ContentFilterTransport } from "@/features/contentfilter/transport";
import type { ContentHold } from "@/features/contentfilter/types";
import { ActionButton } from "@/features/eventhub/components/ActionButton";
import { RemoveReasons } from "@/features/eventhub/components/RemoveReasons";
import {
  usePostCommentActions,
  usePostCommentQueue,
} from "@/features/posts/comments/queries";
import type { PostCommentsTransport } from "@/features/posts/comments/transport";
import type { PostCommentQueueRow } from "@/features/posts/comments/types";
import { ReportNote } from "@/features/reporting/ReportNote";
import { reasonLabel } from "@/features/reporting/reasons";
import { useUndoToast } from "@/features/undo/use-undo-toast";
import { confirmDialog } from "@/lib/dialogs";
import { localizeDigits } from "@/lib/format-numbers";
import { useTheme } from "@/theme";

/** Comments under profile posts to review (migration 0063): held by the word
 * filter or busy-time review (Approve, with the word that matched) and
 * reported ones (Dismiss keeps it up and closes the reports). Hide for
 * moderators, Remove for the official account, each with Undo. Hidden when
 * there are none, or before the migration. */
export function PostCommentQueueSection({
  canRemove,
  transport,
  filterTransport,
}: {
  /** `comments.delete` (the official account). */
  canRemove: boolean;
  transport?: PostCommentsTransport;
  filterTransport?: ContentFilterTransport;
}) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const queue = usePostCommentQueue(true, transport);
  const rows = queue.data ?? [];
  const pendingIds = rows
    .filter((row) => row.status === "pending")
    .map((row) => row.commentId);
  const holds = useHolds("post_comment", pendingIds, true, filterTransport);
  if (rows.length === 0) {
    return null;
  }
  return (
    <View style={{ gap: spacing[2] }} testID="admin-post-comments">
      <Text
        accessibilityRole="header"
        style={[typography.h3, { color: colors.text.primary }]}
      >
        {t("admin.postComments.title")}
      </Text>
      {rows.map((row) => (
        <QueueItem
          key={row.commentId}
          row={row}
          canRemove={canRemove}
          holds={holds[row.commentId]}
          {...(transport ? { transport } : {})}
        />
      ))}
    </View>
  );
}

function QueueItem({
  row,
  canRemove,
  holds,
  transport,
}: {
  row: PostCommentQueueRow;
  canRemove: boolean;
  holds: ContentHold[] | undefined;
  transport?: PostCommentsTransport;
}) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { colors, typography, spacing } = useTheme();
  const actions = usePostCommentActions(transport);
  const showUndo = useUndoToast();
  const [removing, setRemoving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const meta = {
    color: colors.text.secondary,
    fontSize: typography.bodyMeta.fontSize,
    lineHeight: typography.bodyMeta.lineHeight,
  } as const;
  const name = row.displayName ?? t("eventHub.thread.anonymous");

  async function run(action: () => Promise<void>): Promise<boolean> {
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

  async function hide() {
    if (await run(() => actions.moderate(row.commentId, "hide"))) {
      showUndo({
        message: t("snackbar.commentHidden"),
        restore: () => actions.adminRestore(row.commentId),
        admin: true,
      });
    }
  }

  async function remove(reason: string) {
    if (await run(() => actions.adminRemove(row.commentId, reason))) {
      showUndo({
        message: t("snackbar.commentRemoved"),
        restore: () => actions.adminRestore(row.commentId),
        admin: true,
      });
    }
  }

  return (
    <View
      testID={`queue-post-comment-${row.commentId}`}
      style={[
        styles.item,
        {
          backgroundColor: colors.surface.raised,
          borderColor: colors.border.default,
          padding: spacing[3],
          gap: spacing[1],
        },
      ]}
    >
      <ProfileLink username={row.username} name={name}>
        <Text style={[typography.bodyDefault, { color: colors.text.primary }]}>
          {name}
        </Text>
        {row.username ? (
          <Text style={[meta, { writingDirection: "ltr", textAlign: "left" }]}>
            {formatUsername(row.username)}
          </Text>
        ) : null}
      </ProfileLink>
      <Text style={meta} testID={`queue-post-comment-meta-${row.commentId}`}>
        {[
          row.status === "pending" ? t("admin.posts.waiting") : null,
          row.reportCount > 0
            ? t("admin.reports.count", {
                number: localizeDigits(String(row.reportCount), i18n.language),
              })
            : null,
          row.lastReason ? reasonLabel(t, row.lastReason) : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </Text>
      <HoldNote holds={holds} testID={`queue-post-comment-hold-${row.commentId}`} />
      <ReportNote
        note={row.lastNote}
        testID={`queue-post-comment-note-${row.commentId}`}
      />
      <Text
        style={{
          color: colors.text.primary,
          fontSize: typography.bodyDefault.fontSize,
          lineHeight: typography.bodyDefault.lineHeight,
          textAlign: "auto",
        }}
      >
        {row.body}
      </Text>
      {removing ? (
        <RemoveReasons
          disabled={busy}
          onCancel={() => setRemoving(false)}
          onSelect={(reason) =>
            confirmDialog({
              title: t("eventHub.thread.removeConfirmTitle"),
              message: t("eventHub.thread.removeConfirmMessage"),
              confirmLabel: t("eventHub.thread.remove"),
              cancelLabel: t("eventHub.thread.cancel"),
              destructive: true,
              onConfirm: () => void remove(reason),
            })
          }
        />
      ) : (
        <View style={styles.actions}>
          {row.postAuthorUsername ? (
            <ActionButton
              label={t("admin.postComments.openPost")}
              onPress={() => router.push(profileHref(row.postAuthorUsername as string))}
              testID={`queue-post-comment-open-${row.commentId}`}
            />
          ) : null}
          <ActionButton
            label={
              row.status === "pending"
                ? t("eventHub.thread.approve")
                : t("admin.reports.dismiss")
            }
            disabled={busy}
            onPress={() => void run(() => actions.moderate(row.commentId, "approve"))}
            testID={`queue-post-comment-approve-${row.commentId}`}
          />
          <ActionButton
            label={t("eventHub.thread.hide")}
            danger
            disabled={busy}
            onPress={() => void hide()}
            testID={`queue-post-comment-hide-${row.commentId}`}
          />
          {canRemove ? (
            <ActionButton
              label={t("eventHub.thread.remove")}
              danger
              disabled={busy}
              onPress={() => setRemoving(true)}
              testID={`queue-post-comment-remove-${row.commentId}`}
            />
          ) : null}
        </View>
      )}
      {errorText ? (
        <Text accessibilityRole="alert" style={[meta, { color: colors.status.danger }]}>
          {errorText}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  item: { borderWidth: 1, borderRadius: 12 },
  actions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center" },
});
