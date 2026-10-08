import { useRouter } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { communityErrorText } from "@/features/community/error-text";
import { ProfileLink } from "@/features/community/components/ProfileLink";
import { profileHref } from "@/features/community/routes";
import { formatUsername } from "@/features/community/username";
import { ActionButton } from "@/features/eventhub/components/ActionButton";
import { RemoveReasons } from "@/features/eventhub/components/RemoveReasons";
import { LimitAccountButton } from "@/features/restrictions/components/LimitAccountButton";
import type { EventHubTransport } from "@/features/eventhub/transport";
import type { PostsTransport } from "@/features/posts/transport";
import { ReportNote } from "@/features/reporting/ReportNote";
import { reasonLabel } from "@/features/reporting/reasons";
import { useUndoToast } from "@/features/undo/use-undo-toast";
import { confirmDialog } from "@/lib/dialogs";
import { localizeDigits } from "@/lib/format-numbers";
import { useTheme } from "@/theme";
import { useAdminActions, useReportedPosts } from "../queries";
import type { AdminTransport } from "../transport";
import type { ReportedPost } from "../types";

/** Profile posts readers reported: Open the author's profile, Remove (admins
 * with `posts.delete`) or Dismiss the reports. Hidden when there are none, or
 * before migration 0050 is applied. */
export function ReportedPostsSection({
  canRemove,
  canRestrict = false,
  canSuspend = false,
  transport,
  hubTransport,
  postsTransport,
}: {
  canRemove: boolean;
  /** `accounts.restrict`: show "Limit account" on each row. */
  canRestrict?: boolean;
  /** `accounts.suspend`: the sheet also offers Suspend. */
  canSuspend?: boolean;
  transport?: AdminTransport;
  hubTransport?: EventHubTransport;
  postsTransport?: PostsTransport;
}) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const reports = useReportedPosts(true, transport);
  const actions = useAdminActions(transport, hubTransport, postsTransport);

  const rows = reports.data ?? [];
  if (rows.length === 0) {
    return null;
  }
  return (
    <View style={{ gap: spacing[2] }} testID="admin-posts">
      <Text
        accessibilityRole="header"
        style={[typography.h3, { color: colors.text.primary }]}
      >
        {t("admin.posts.title")}
      </Text>
      {rows.map((row) => (
        <ReportedPostItem
          key={row.postId}
          row={row}
          canRemove={canRemove}
          canRestrict={canRestrict}
          canSuspend={canSuspend}
          actions={actions}
        />
      ))}
    </View>
  );
}

function ReportedPostItem({
  row,
  canRemove,
  canRestrict,
  canSuspend,
  actions,
}: {
  row: ReportedPost;
  canRemove: boolean;
  canRestrict: boolean;
  canSuspend: boolean;
  actions: ReturnType<typeof useAdminActions>;
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

  /** Remove, then offer Undo for 10 s (the server did it already). */
  async function removePost(reason: string) {
    if (await run(() => actions.removePost(row.postId, reason))) {
      showUndo({
        message: t("snackbar.postRemoved"),
        restore: () => actions.restorePost(row.postId),
        admin: true,
      });
    }
  }

  return (
    <View
      testID={`reported-post-${row.postId}`}
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
      <ProfileLink
        username={row.username}
        name={row.displayName ?? t("eventHub.thread.anonymous")}
        testID={`reported-post-name-${row.postId}`}
      >
        <Text style={[typography.bodyDefault, { color: colors.text.primary }]}>
          {row.displayName ?? t("eventHub.thread.anonymous")}
        </Text>
        {row.username ? (
          <Text style={[meta, { writingDirection: "ltr", textAlign: "left" }]}>
            {formatUsername(row.username)}
          </Text>
        ) : null}
      </ProfileLink>
      <Text style={meta}>
        {[
          t("admin.reports.count", {
            number: localizeDigits(String(row.reportCount), i18n.language),
          }),
          row.lastReason ? reasonLabel(t, row.lastReason) : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </Text>
      <ReportNote note={row.lastNote} testID={`reported-post-note-${row.postId}`} />
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
              title: t("posts.removeConfirmTitle"),
              message: t("posts.removeConfirmMessage"),
              confirmLabel: t("posts.remove"),
              cancelLabel: t("eventHub.thread.cancel"),
              destructive: true,
              onConfirm: () => void removePost(reason),
            })
          }
        />
      ) : (
        <View style={styles.actions}>
          {row.username ? (
            <ActionButton
              label={t("admin.reports.open")}
              onPress={() => router.push(profileHref(row.username as string))}
              testID={`reported-post-open-${row.postId}`}
            />
          ) : null}
          {canRemove ? (
            <ActionButton
              label={t("posts.remove")}
              danger
              disabled={busy}
              onPress={() => setRemoving(true)}
              testID={`reported-post-remove-${row.postId}`}
            />
          ) : null}
          {canRestrict ? (
            <LimitAccountButton
              target={{
                userId: row.authorId,
                name: row.displayName ?? row.username ?? t("eventHub.thread.anonymous"),
              }}
              canSuspend={canSuspend}
              testID={`reported-post-limit-${row.postId}`}
            />
          ) : null}
          <ActionButton
            label={t("admin.reports.dismiss")}
            disabled={busy}
            onPress={() => void run(() => actions.dismissPostReports(row.postId))}
            testID={`reported-post-dismiss-${row.postId}`}
          />
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
