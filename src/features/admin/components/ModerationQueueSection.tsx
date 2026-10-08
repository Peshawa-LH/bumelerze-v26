import { useRouter } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { communityErrorText } from "@/features/community/error-text";
import { ActionButton } from "@/features/eventhub/components/ActionButton";
import { RemoveReasons } from "@/features/eventhub/components/RemoveReasons";
import { ReportNote } from "@/features/reporting/ReportNote";
import { reasonLabel } from "@/features/reporting/reasons";
import { useUndoToast } from "@/features/undo/use-undo-toast";
import { localizeDigits } from "@/lib/format-numbers";
import { confirmDialog } from "@/lib/dialogs";
import { useTheme } from "@/theme";
import { useAdminActions, useModerationQueue, type AdminActions } from "../queries";
import type { EventHubTransport } from "@/features/eventhub/transport";
import type { AdminTransport } from "../transport";
import type { QueueComment } from "../types";

/** Comments waiting for review (new from anonymous installs, or flagged by
 * readers): Approve, Hide, and for admins Remove. */
export function ModerationQueueSection({
  canDelete,
  transport,
  hubTransport,
}: {
  canDelete: boolean;
  transport?: AdminTransport;
  hubTransport?: EventHubTransport;
}) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const queue = useModerationQueue(true, transport);
  const actions = useAdminActions(transport, hubTransport);
  const meta = {
    color: colors.text.secondary,
    fontSize: typography.bodyMeta.fontSize,
    lineHeight: typography.bodyMeta.lineHeight,
  } as const;

  return (
    <View style={{ gap: spacing[2] }} testID="admin-queue">
      <Text
        accessibilityRole="header"
        style={[typography.h3, { color: colors.text.primary }]}
      >
        {t("admin.queue.title")}
      </Text>
      {queue.isLoading ? (
        <Text style={meta}>{t("eventDetail.loading")}</Text>
      ) : queue.isError ? (
        <Text style={meta}>{communityErrorText(t, queue.error)}</Text>
      ) : (queue.data ?? []).length === 0 ? (
        <Text style={meta} testID="admin-queue-empty">
          {t("admin.queue.empty")}
        </Text>
      ) : (
        (queue.data ?? []).map((comment) => (
          <QueueItem
            key={comment.id}
            comment={comment}
            actions={actions}
            canDelete={canDelete}
          />
        ))
      )}
    </View>
  );
}

function QueueItem({
  comment,
  actions,
  canDelete,
}: {
  comment: QueueComment;
  actions: AdminActions;
  canDelete: boolean;
}) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { colors, typography, spacing } = useTheme();
  const [removing, setRemoving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const showUndo = useUndoToast();
  const meta = {
    color: colors.text.secondary,
    fontSize: typography.bodyMeta.fontSize,
    lineHeight: typography.bodyMeta.lineHeight,
  } as const;

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

  /** Hide or remove, then offer Undo for 10 s (the server did it already). */
  async function takeDown(kind: "hidden" | "removed", action: () => Promise<void>) {
    if (await run(action)) {
      showUndo({
        message: t(
          kind === "hidden" ? "snackbar.commentHidden" : "snackbar.commentRemoved",
        ),
        restore: () => actions.restoreComment(comment.id),
        admin: true,
      });
    }
  }

  const status =
    comment.status === "pending"
      ? t("admin.queue.new")
      : t("admin.queue.flagged", {
          number: localizeDigits(String(comment.flagCount), i18n.language),
        });
  const reason = comment.lastReason ? reasonLabel(t, comment.lastReason) : null;

  return (
    <View
      testID={`queue-${comment.id}`}
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
      <Text style={meta}>
        {`${comment.authorName ?? t("eventHub.thread.anonymous")} · ${status}`}
      </Text>
      {reason ? (
        <Text style={meta} testID={`queue-reason-${comment.id}`}>
          {t("admin.reports.reason", { reason })}
        </Text>
      ) : null}
      <ReportNote note={comment.lastNote} testID={`queue-note-${comment.id}`} />
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
              onConfirm: () =>
                void takeDown("removed", () => actions.remove(comment.id, reason)),
            })
          }
        />
      ) : (
        <View style={styles.actions}>
          {comment.hubId ? (
            <ActionButton
              label={t("admin.queue.open")}
              onPress={() => router.push(`/event-hub/${comment.hubId as string}`)}
              testID={`queue-open-${comment.id}`}
            />
          ) : null}
          <ActionButton
            label={t("eventHub.thread.approve")}
            disabled={busy}
            onPress={() => void run(() => actions.moderate(comment.id, "approve"))}
            testID={`queue-approve-${comment.id}`}
          />
          <ActionButton
            label={t("eventHub.thread.hide")}
            danger
            disabled={busy}
            onPress={() =>
              void takeDown("hidden", () => actions.moderate(comment.id, "hide"))
            }
            testID={`queue-hide-${comment.id}`}
          />
          {canDelete ? (
            <ActionButton
              label={t("eventHub.thread.remove")}
              danger
              disabled={busy}
              onPress={() => setRemoving(true)}
              testID={`queue-remove-${comment.id}`}
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
