import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";

import { communityErrorText } from "@/features/community/error-text";
import { ActionButton } from "@/features/eventhub/components/ActionButton";
import { RemoveReasons } from "@/features/eventhub/components/RemoveReasons";
import { ReportSheet } from "@/features/reporting/ReportSheet";
import type { ReportInput } from "@/features/reporting/reasons";
import {
  formatRelativeTimeValue,
  getRelativeTime,
  isolateNumeric,
} from "@/features/events";
import { confirmDialog } from "@/lib/dialogs";
import { localizeDigits } from "@/lib/format-numbers";
import { useUndoToast } from "@/features/undo/use-undo-toast";
import { useTheme } from "@/theme";
import { EVENT_POST_MAX_LENGTH, POST_MAX_LENGTH } from "../constants";
import type { PostActions } from "../queries";
import type { ProfilePost } from "../types";
import { validatePostEdit } from "../validation";
import { EventPostCard } from "./EventPostCard";
import {
  PostCommentsSection,
  type CommentsViewer,
} from "../comments/components/PostCommentsSection";
import type { PostCommentsTransport } from "../comments/transport";
import { MentionText } from "@/features/mentions/components/MentionText";

interface PostItemProps {
  post: ProfilePost;
  /** The viewer wrote it (this is their own profile page). */
  isOwn: boolean;
  /** The viewer may report posts: signed in, even anonymously. */
  canReport: boolean;
  /** The viewer may mark posts helpful: a real account (not a guest). */
  canHelp?: boolean;
  /** The viewer holds `posts.delete`. */
  canAdminRemove: boolean;
  /** This is the profile's pinned post (shown first, with a "Pinned" line). */
  isPinned?: boolean;
  /** Clock for the relative time (UTC ms). */
  nowMs: number;
  actions: PostActions;
  /** Who reads the comments under the post (migration 0063); no comments
   * part when left out. */
  commentsViewer?: CommentsViewer;
  /** Test seam for the comments. */
  commentsTransport?: PostCommentsTransport;
}

type Mode = "idle" | "reporting" | "adminRemove" | "editing" | "editLocked";

/** One post on a profile: relative time ("Edited" once changed), an
 * earthquake card for a shared event, the text, and the actions that fit the
 * viewer: Edit, Pin and Delete for the author, Helpful and Report for others,
 * Remove for admins. The author and photo are in the profile header already,
 * so they are not repeated. */
export function PostItem({
  post,
  isOwn,
  canReport,
  canHelp = false,
  canAdminRemove,
  isPinned = false,
  nowMs,
  actions,
  commentsViewer,
  commentsTransport,
}: PostItemProps) {
  const { t, i18n } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const [mode, setMode] = useState<Mode>("idle");
  const [busy, setBusy] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [reported, setReported] = useState(false);
  const [draft, setDraft] = useState(post.body);
  // The server's answer to my last Helpful tap, until the list refreshes.
  const [helpful, setHelpful] = useState<{ mine: boolean; count: number } | null>(null);
  const showUndo = useUndoToast();
  const locale = i18n.language;

  const relativeText = (ms: number) => {
    const relative = getRelativeTime(ms, nowMs);
    return relative.unit === "justNow"
      ? t("events.relativeTime.justNow")
      : t(`events.relativeTime.${relative.unit}`, {
          value: formatRelativeTimeValue(relative.value, locale),
        });
  };
  const timeText = relativeText(post.createdAt);
  const editedText =
    post.editedAt !== null
      ? t("posts.edited", { time: relativeText(post.editedAt) })
      : null;

  const meta = {
    color: colors.text.secondary,
    fontSize: typography.bodyMeta.fontSize,
    lineHeight: typography.bodyMeta.lineHeight,
  } as const;

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

  function startEdit() {
    setErrorText(null);
    if (post.editLocked) {
      setMode("editLocked");
      return;
    }
    setDraft(post.body);
    setMode("editing");
  }

  async function saveEdit() {
    const ok = await run(() => actions.edit(post.id, draft.trim()));
    if (ok) {
      setMode("idle");
    }
  }

  async function toggleHelpful() {
    const next = !(helpful?.mine ?? post.myHelpful);
    await run(async () => {
      const answer = await actions.setHelpful(post.id, next);
      setHelpful({ mine: answer.helpful, count: answer.count });
    });
  }

  const removed = post.status === "removed";
  // Held for review (migration 0059): only the author sees it; it can be
  // deleted but not edited, pinned, marked or reported until it is approved.
  const pending = post.status === "pending";
  const isEvent = post.kind === "event";
  const myHelpful = helpful?.mine ?? post.myHelpful;
  const helpfulCount = helpful?.count ?? post.helpfulCount;
  const helpfulCountText = isolateNumeric(localizeDigits(String(helpfulCount), locale));
  const helpfulLabel =
    helpfulCount > 0
      ? t("posts.helpfulCount", { number: helpfulCountText })
      : t("posts.helpful");

  const max = isEvent ? EVENT_POST_MAX_LENGTH : POST_MAX_LENGTH;
  const draftProblem = validatePostEdit(draft, post.kind);
  const usedText = localizeDigits(String(draft.trim().length), locale);
  const maxText = localizeDigits(String(max), locale);

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
      {isPinned ? (
        <View style={[styles.row, { gap: spacing[1] }]} testID={`post-pinned-${post.id}`}>
          <Ionicons name="pin" size={14} color={colors.text.secondary} />
          <Text style={meta}>{t("posts.pinned")}</Text>
        </View>
      ) : null}

      <Text style={meta}>
        {timeText}
        {editedText ? (
          <Text testID={`post-edited-${post.id}`}>{` · ${editedText}`}</Text>
        ) : null}
      </Text>

      {!removed && isEvent && post.event ? (
        <EventPostCard event={post.event} testID={`post-event-${post.id}`} />
      ) : null}

      {removed ? (
        <Text style={[meta, { fontStyle: "italic" }]} testID={`post-removed-${post.id}`}>
          {t("posts.removedByModerators")}
        </Text>
      ) : mode === "editing" ? (
        <View style={{ gap: spacing[2] }}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            multiline
            editable={!busy}
            textAlignVertical="top"
            accessibilityLabel={t("posts.editLabel")}
            testID={`post-edit-input-${post.id}`}
            style={[
              styles.input,
              {
                color: colors.text.primary,
                borderColor:
                  draftProblem === "too_long"
                    ? colors.status.danger
                    : colors.border.default,
                backgroundColor: colors.surface.base,
                fontSize: typography.bodyDefault.fontSize,
                padding: spacing[3],
                textAlign: "auto",
              },
            ]}
          />
          <Text
            style={[
              meta,
              draftProblem === "too_long" ? { color: colors.status.danger } : null,
            ]}
            accessibilityLabel={t("posts.composer.counterA11y", {
              used: usedText,
              max: maxText,
            })}
            testID={`post-edit-counter-${post.id}`}
          >
            {isolateNumeric(`${usedText}/${maxText}`)}
          </Text>
          <View style={[styles.row, { gap: spacing[1] }]}>
            <ActionButton
              label={busy ? t("account.profile.saving") : t("posts.save")}
              disabled={busy || draftProblem !== null}
              onPress={() => void saveEdit()}
              testID={`post-edit-save-${post.id}`}
            />
            <ActionButton
              label={t("eventHub.thread.cancel")}
              disabled={busy}
              onPress={() => setMode("idle")}
              testID={`post-edit-cancel-${post.id}`}
            />
          </View>
        </View>
      ) : post.body !== "" ? (
        <MentionText
          text={post.body}
          testID={`post-body-${post.id}`}
          style={{
            color: colors.text.primary,
            fontSize: typography.bodyDefault.fontSize,
            lineHeight: typography.bodyDefault.lineHeight,
            // Follows the language of the post, not of the app.
            textAlign: "auto",
          }}
        />
      ) : null}

      {pending ? (
        <Text
          accessibilityLiveRegion="polite"
          style={[meta, { fontStyle: "italic" }]}
          testID={`post-pending-${post.id}`}
        >
          {t("posts.pending")}
        </Text>
      ) : null}

      {mode === "editLocked" ? (
        <Text
          accessibilityLiveRegion="polite"
          style={meta}
          testID={`post-edit-locked-${post.id}`}
        >
          {t("posts.editLocked")}
        </Text>
      ) : null}

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
      ) : mode === "editing" ? null : (
        <View style={styles.actions}>
          {canHelp && !isOwn && !removed && !pending ? (
            <ActionButton
              label={helpfulLabel}
              selected={myHelpful}
              disabled={busy}
              onPress={() => void toggleHelpful()}
              testID={`post-helpful-${post.id}`}
            />
          ) : !removed && !pending && helpfulCount > 0 ? (
            <Text
              style={[meta, styles.staticAction]}
              testID={`post-helpful-count-${post.id}`}
            >
              {helpfulLabel}
            </Text>
          ) : null}
          {isOwn && !removed && !pending ? (
            <ActionButton
              label={t("posts.edit")}
              disabled={busy}
              onPress={startEdit}
              testID={`post-edit-${post.id}`}
            />
          ) : null}
          {isOwn && !removed && !pending ? (
            <ActionButton
              label={isPinned ? t("posts.unpin") : t("posts.pin")}
              disabled={busy}
              onPress={() => void run(() => actions.setPinned(isPinned ? null : post.id))}
              testID={`post-pin-${post.id}`}
            />
          ) : null}
          {isOwn && !removed ? (
            <ActionButton
              label={t("posts.delete")}
              danger
              disabled={busy}
              onPress={() => void deleteOwn()}
              testID={`post-delete-${post.id}`}
            />
          ) : null}
          {!isOwn && !removed && !pending && canReport && !reported ? (
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
        <Text
          accessibilityRole="alert"
          style={[meta, { color: colors.status.danger }]}
          testID={`post-error-${post.id}`}
        >
          {errorText}
        </Text>
      ) : null}

      {commentsViewer && post.status === "visible" && mode !== "editing" ? (
        <PostCommentsSection
          postId={post.id}
          commentCount={post.commentCount}
          commentsOff={post.commentsOff}
          isPostOwner={isOwn}
          viewer={commentsViewer}
          {...(commentsTransport ? { transport: commentsTransport } : {})}
        />
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
  row: { flexDirection: "row", alignItems: "center" },
  actions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center" },
  staticAction: { paddingHorizontal: 8 },
  input: { minHeight: 88, borderWidth: 1, borderRadius: 12 },
});
