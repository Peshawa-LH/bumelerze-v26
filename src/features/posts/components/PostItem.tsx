import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";

import { Avatar, getAvatarUrl } from "@/features/account";
import { communityErrorText } from "@/features/community/error-text";
import { profileShareUrl } from "@/features/community/components/ProfileShareSheet";
import { ActionButton } from "@/features/eventhub/components/ActionButton";
import { RemoveReasons } from "@/features/eventhub/components/RemoveReasons";
import { RoleMark } from "@/features/eventhub/components/RoleMark";
import type { HubRole } from "@/features/eventhub/types";
import { ReportSheet } from "@/features/reporting/ReportSheet";
import type { ReportInput } from "@/features/reporting/reasons";
import {
  formatRelativeTimeValue,
  getRelativeTime,
  isolateNumeric,
} from "@/features/events";
import { buildShareUrl } from "@/features/share/caption";
import { shareText } from "@/features/share/share-text";
import { ActionRow } from "@/features/social/components/ActionRow";
import type { MenuItem } from "@/features/social/components/MenuSheet";
import { PostHeader } from "@/features/social/components/PostHeader";
import type { SocialTransport } from "@/features/social/transport";
import { confirmDialog } from "@/lib/dialogs";
import { localizeDigits } from "@/lib/format-numbers";
import { useUndoToast } from "@/features/undo/use-undo-toast";
import { useTheme, nativeFontFamily, READING_START } from "@/theme";
import { EVENT_POST_MAX_LENGTH, POST_MAX_LENGTH } from "../constants";
import type { PostActions } from "../queries";
import type { ProfilePost } from "../types";
import { validatePostEdit } from "../validation";
import { EventPostCard } from "./EventPostCard";
import {
  PostCommentsSection,
  type CommentsViewer,
} from "../comments/components/PostCommentsSection";
import { usePostCommentActions } from "../comments/queries";
import type { PostCommentsTransport } from "../comments/transport";
import { MentionText } from "@/features/mentions/components/MentionText";

/** Who wrote the post: the profile's own public fields. */
export interface PostAuthor {
  displayName: string;
  username: string;
  avatarPath: string | null;
  roles: readonly HubRole[];
}

interface PostItemProps {
  post: ProfilePost;
  /** The profile the post is on (its author). */
  author: PostAuthor;
  /** The viewer wrote it (this is their own profile page). */
  isOwn: boolean;
  /** The viewer may report posts: signed in, even anonymously. */
  canReport: boolean;
  /** The viewer may give hearts: a real account (not a guest). */
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
  /** Test seams for the comments and their hearts. */
  commentsTransport?: PostCommentsTransport;
  socialTransport?: SocialTransport;
}

type Mode = "idle" | "reporting" | "adminRemove" | "editing" | "editLocked";

/** One post on a profile, built like the Event hub's post (review note
 * 5.1): the author's photo, name, rank mark and time with "...", the text and
 * the shared earthquake, then one action row (heart, comments, share) and
 * the comments drawn with the hub's comment component. Edit, Pin, comments
 * on or off and Delete are the author's "..." rows; Report for others;
 * Remove for admins. The heart is the post's Helpful mark (0058): same count,
 * same badge. */
export function PostItem({
  post,
  author,
  isOwn,
  canReport,
  canHelp = false,
  canAdminRemove,
  isPinned = false,
  nowMs,
  actions,
  commentsViewer,
  commentsTransport,
  socialTransport,
}: PostItemProps) {
  const { t, i18n } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const [mode, setMode] = useState<Mode>("idle");
  const [busy, setBusy] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reported, setReported] = useState(false);
  const [draft, setDraft] = useState(post.body);
  const [commentsOpen, setCommentsOpen] = useState(false);
  // The server's answer to my last heart tap, until the list refreshes.
  const [helpful, setHelpful] = useState<{ mine: boolean; count: number } | null>(null);
  const showUndo = useUndoToast();
  const commentActions = usePostCommentActions(commentsTransport);
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
    fontFamily: nativeFontFamily(typography.bodyMeta),
    ...READING_START,
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

  async function setCommentsOff(off: boolean) {
    const ok = await run(() => commentActions.setCommentsOff(post.id, off));
    if (ok && off) {
      showUndo({
        message: t("postComments.offDone"),
        restore: () => commentActions.setCommentsOff(post.id, false),
      });
    }
  }

  async function share() {
    const link =
      post.kind === "event" && post.event?.ref
        ? buildShareUrl(post.event.ref)
        : profileShareUrl(author.username);
    const text = post.body ? `${post.body}\n${link}` : link;
    const outcome = await shareText(text, author.displayName);
    setNotice(outcome === "copied" ? t("share.linkCopied") : null);
  }

  const removed = post.status === "removed";
  // Held for review (migration 0059): only the author sees it; it can be
  // deleted but not edited, pinned, marked or reported until it is approved.
  const pending = post.status === "pending";
  const isEvent = post.kind === "event";
  const myHelpful = helpful?.mine ?? post.myHelpful;
  const helpfulCount = helpful?.count ?? post.helpfulCount;

  const max = isEvent ? EVENT_POST_MAX_LENGTH : POST_MAX_LENGTH;
  const draftProblem = validatePostEdit(draft, post.kind);
  const usedText = localizeDigits(String(draft.trim().length), locale);
  const maxText = localizeDigits(String(max), locale);
  const live = !removed && !pending;

  const items: MenuItem[] = [];
  if (isOwn && live) {
    items.push({
      key: "edit",
      icon: "create-outline",
      label: t("posts.edit"),
      disabled: busy,
      onPress: startEdit,
      testID: `post-edit-${post.id}`,
    });
    items.push({
      key: "pin",
      icon: "pin-outline",
      label: isPinned ? t("posts.unpin") : t("posts.pin"),
      disabled: busy,
      onPress: () => void run(() => actions.setPinned(isPinned ? null : post.id)),
      testID: `post-pin-${post.id}`,
    });
    if (post.status === "visible") {
      items.push({
        key: "comments",
        icon: post.commentsOff ? "chatbubble-outline" : "chatbubble-ellipses-outline",
        label: post.commentsOff ? t("postComments.turnOn") : t("postComments.turnOff"),
        disabled: busy,
        onPress: () => void setCommentsOff(!post.commentsOff),
        testID: `post-comments-switch-${post.id}`,
      });
    }
  }
  if (!isOwn && live && canReport && !reported) {
    items.push({
      key: "report",
      icon: "flag-outline",
      label: t("posts.report"),
      detail: t("social.menu.reportDetail"),
      onPress: () => setMode("reporting"),
      testID: `post-report-${post.id}`,
    });
  }
  if (isOwn && !removed) {
    items.push({
      key: "delete",
      icon: "trash-outline",
      label: t("posts.delete"),
      detail: t("social.menu.deleteDetail"),
      danger: true,
      disabled: busy,
      onPress: () => void deleteOwn(),
      testID: `post-delete-${post.id}`,
    });
  }
  if (canAdminRemove && !isOwn && !removed) {
    items.push({
      key: "remove",
      icon: "trash-outline",
      label: t("posts.remove"),
      detail: t("posts.removeConfirmMessage"),
      badge: t("social.menu.moderatorsOnly"),
      danger: true,
      onPress: () => setMode("adminRemove"),
      testID: `post-remove-${post.id}`,
    });
  }

  return (
    <View
      testID={`post-${post.id}`}
      style={[
        styles.card,
        {
          borderBottomColor: colors.border.subtle,
          paddingVertical: spacing[3],
          gap: spacing[2],
        },
      ]}
    >
      {isPinned ? (
        <View style={[styles.row, { gap: spacing[1] }]} testID={`post-pinned-${post.id}`}>
          <Ionicons name="pin" size={14} color={colors.text.secondary} />
          <Text style={meta}>{t("posts.pinned")}</Text>
        </View>
      ) : null}

      <PostHeader
        testID={`post-header-${post.id}`}
        leading={
          <Avatar
            uri={getAvatarUrl(author.avatarPath)}
            name={author.displayName}
            size={36}
            testID={`post-avatar-${post.id}`}
          />
        }
        title={
          <Text
            numberOfLines={1}
            style={[
              styles.name,
              {
                color: colors.text.primary,
                fontSize: typography.bodyDefault.fontSize,
                fontFamily: nativeFontFamily(typography.bodyDefault),
                ...READING_START,
              },
            ]}
          >
            {author.displayName}
          </Text>
        }
        mark={<RoleMark roles={author.roles} explain />}
        subtitle={editedText ? `${timeText} · ${editedText}` : timeText}
        menuItems={items}
        moreLabel={t("social.moreOptions")}
      />

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
                fontFamily: nativeFontFamily(typography.bodyDefault),
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
            fontFamily: nativeFontFamily(typography.bodyDefault),
            lineHeight: typography.bodyDefault.lineHeight,
            // Follows the language of the post, not of the app.
            textAlign: "auto",
          }}
        />
      ) : null}

      {!removed && isEvent && post.event ? (
        <EventPostCard event={post.event} testID={`post-event-${post.id}`} />
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
      ) : null}

      {live && mode !== "editing" ? (
        <ActionRow
          testID={`post-actions-${post.id}`}
          heart={{
            count: helpfulCount,
            liked: myHelpful,
            disabled: busy,
            onToggle: canHelp && !isOwn ? () => void toggleHelpful() : undefined,
          }}
          comments={
            commentsViewer && post.status === "visible"
              ? {
                  count: post.commentCount,
                  onPress: () => setCommentsOpen((open) => !open),
                }
              : undefined
          }
          onShare={() => void share()}
        />
      ) : null}

      {reported ? (
        <Text style={meta} testID={`post-reported-${post.id}`}>
          {t("posts.reported")}
        </Text>
      ) : null}
      {notice ? (
        <Text style={meta} accessibilityLiveRegion="polite">
          {notice}
        </Text>
      ) : null}
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
          open={commentsOpen}
          onOpenChange={setCommentsOpen}
          {...(commentsTransport ? { transport: commentsTransport } : {})}
          {...(socialTransport ? { socialTransport } : {})}
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
  card: { borderBottomWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: "row", alignItems: "center" },
  name: { fontWeight: "600", flexShrink: 1 },
  input: { minHeight: 88, borderWidth: 1, borderRadius: 12 },
});
