import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { communityErrorText } from "@/features/community/error-text";
import { ActionButton } from "@/features/eventhub/components/ActionButton";
import { RemoveReasons } from "@/features/eventhub/components/RemoveReasons";
import { ReportSheet } from "@/features/reporting/ReportSheet";
import type { ReportInput } from "@/features/reporting/reasons";
import { formatRelativeTimeValue, getRelativeTime } from "@/features/events";
import { confirmDialog } from "@/lib/dialogs";
import { useUndoToast } from "@/features/undo/use-undo-toast";
import { useTheme } from "@/theme";
import type { PostActions } from "../queries";
import type { ProfilePost } from "../types";

interface PostItemProps {
  post: ProfilePost;
  /** The viewer wrote it (this is their own profile page). */
  isOwn: boolean;
  /** The viewer may report posts: signed in, even anonymously. */
  canReport: boolean;
  /** The viewer holds `posts.delete`. */
  canAdminRemove: boolean;
  /** Clock for the relative time (UTC ms). */
  nowMs: number;
  actions: PostActions;
}

type Mode = "idle" | "reporting" | "adminRemove";

/** One post on a profile: relative time, text, and the actions that fit the
 * viewer (Delete for the author, Report for others, Remove for admins). The
 * author and photo are in the profile header already, so they are not repeated. */
export function PostItem({
  post,
  isOwn,
  canReport,
  canAdminRemove,
  nowMs,
  actions,
}: PostItemProps) {
  const { t, i18n } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const [mode, setMode] = useState<Mode>("idle");
  const [busy, setBusy] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [reported, setReported] = useState(false);
  const showUndo = useUndoToast();

  const relative = getRelativeTime(post.createdAt, nowMs);
  const timeText =
    relative.unit === "justNow"
      ? t("events.relativeTime.justNow")
      : t(`events.relativeTime.${relative.unit}`, {
          value: formatRelativeTimeValue(relative.value, i18n.language),
        });

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

  /** No confirmation: the server deletes at once and the snackbar's Undo
   * (8 s) or the Profile's "Recently deleted" (24 h) brings it back. */
  async function deleteOwn() {
    const ok = await run(() => actions.remove(post.id));
    if (ok) {
      showUndo({
        message: t("snackbar.postDeleted"),
        restore: () => actions.restore(post.id),
      });
    }
  }

  async function sendReport({ reason, note }: ReportInput) {
    await actions.report(post.id, reason, note);
    setReported(true);
  }

  const removed = post.status === "removed";

  return (
    <View
      testID={`post-${post.id}`}
      style={[
        styles.card,
        {
          backgroundColor: colors.surface.raised,
          borderColor: colors.border.default,
          padding: spacing[3],
          gap: spacing[1],
        },
      ]}
    >
      <Text style={meta}>{timeText}</Text>

      {removed ? (
        <Text style={[meta, { fontStyle: "italic" }]} testID={`post-removed-${post.id}`}>
          {t("posts.removedByModerators")}
        </Text>
      ) : (
        <Text
          testID={`post-body-${post.id}`}
          style={{
            color: colors.text.primary,
            fontSize: typography.bodyDefault.fontSize,
            lineHeight: typography.bodyDefault.lineHeight,
            // Follows the language of the post, not of the app.
            textAlign: "auto",
          }}
        >
          {post.body}
        </Text>
      )}

      {mode === "adminRemove" ? (
        <RemoveReasons
          testID={`post-remove-reasons-${post.id}`}
          disabled={busy}
          onCancel={() => setMode("idle")}
          onSelect={(reason) =>
            confirmDialog({
              title: t("posts.removeConfirmTitle"),
              message: t("posts.removeConfirmMessage"),
              confirmLabel: t("posts.remove"),
              cancelLabel: t("eventHub.thread.cancel"),
              destructive: true,
              onConfirm: () =>
                void run(() => actions.adminRemove(post.id, reason)).then((ok) => {
                  if (ok) {
                    setMode("idle");
                    showUndo({
                      message: t("snackbar.postRemoved"),
                      restore: () => actions.adminRestore(post.id),
                      admin: true,
                    });
                  }
                }),
            })
          }
        />
      ) : (
        <View style={styles.actions}>
          {isOwn && !removed ? (
            <ActionButton
              label={t("posts.delete")}
              danger
              disabled={busy}
              onPress={() => void deleteOwn()}
              testID={`post-delete-${post.id}`}
            />
          ) : null}
          {!isOwn && !removed && canReport && !reported ? (
            <ActionButton
              label={t("posts.report")}
              onPress={() => setMode("reporting")}
              testID={`post-report-${post.id}`}
            />
          ) : null}
          {reported ? (
            <Text style={[meta, styles.staticAction]} testID={`post-reported-${post.id}`}>
              {t("posts.reported")}
            </Text>
          ) : null}
          {canAdminRemove && !isOwn && !removed ? (
            <ActionButton
              label={t("posts.remove")}
              danger
              onPress={() => setMode("adminRemove")}
              testID={`post-remove-${post.id}`}
            />
          ) : null}
        </View>
      )}

      {errorText ? (
        <Text accessibilityRole="alert" style={[meta, { color: colors.status.danger }]}>
          {errorText}
        </Text>
      ) : null}

      {mode === "reporting" ? (
        <ReportSheet
          kind="post"
          testID={`post-report-sheet-${post.id}`}
          onSubmit={sendReport}
          onClose={() => setMode("idle")}
          errorText={(error) => communityErrorText(t, error)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 12 },
  actions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center" },
  staticAction: { paddingHorizontal: 8 },
});
