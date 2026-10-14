import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { useState, type ReactNode } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { Avatar, getAvatarUrl } from "@/features/account";
import { profileHref } from "@/features/community/routes";
import { RoleMark } from "@/features/eventhub/components/RoleMark";
import type { HubRole } from "@/features/eventhub/types";
import { MentionText } from "@/features/mentions/components/MentionText";
import { useTheme } from "@/theme";
import { HeartButton, type HeartButtonProps } from "./HeartButton";
import { MenuSheet, type MenuItem } from "./MenuSheet";
import { Indented } from "./ReplyToggle";

export interface CommentRowAuthor {
  /** The name to show; the official account's is replaced by its localized
   * name ("Bumelerze", in Sorani "تۆڕی بوومەلەرزە"). */
  name: string;
  username: string | null;
  avatarPath: string | null;
  roles: readonly HubRole[] | undefined;
}

export interface CommentRowProps {
  id: string;
  /** "comment" in the Event hub, "post-comment" under posts: test ids only. */
  testIDPrefix?: string;
  author: CommentRowAuthor;
  body: string;
  /** "3d", "Just now". */
  timeText: string;
  /** A second line under the name, e.g. "felt it near Slemani". */
  meta?: string | null;
  isReply?: boolean;
  /** The hub's pinned note: a "Pinned by Bumelerze" line and a raised card. */
  pinned?: boolean;
  /** The viewer follows the author: a small "Following" word. */
  following?: boolean;
  /** "Waiting for review" line: the author's own held comment. */
  pendingText?: string | null;
  heart?: Omit<HeartButtonProps, "size" | "testID"> | null;
  onReply?: (() => void) | undefined;
  /** The "..." menu rows, in order (destructive last). Empty: no "...". */
  menuItems?: readonly MenuItem[];
  /** In place of the comment: "Comment removed", "Deleted account". */
  placeholder?: { text: string; testID: string } | null;
  /** Inline things under the actions: a reason picker, a note, an error. */
  footer?: ReactNode;
}

/**
 * THE comment: the one component every comment in the app is drawn with,
 * in the Event hub and under profile posts (review note 4.4). Avatar, name
 * and rank mark, time, the text with @mention links, then a small "Reply"
 * and the heart with its count. Everything else (Delete, Pin, Mute, Report,
 * Remove) lives in the "..." bottom sheet the caller fills. Replies are
 * indented with a smaller avatar.
 */
export function CommentRow({
  id,
  testIDPrefix = "comment",
  author,
  body,
  timeText,
  meta,
  isReply = false,
  pinned = false,
  following = false,
  pendingText,
  heart,
  onReply,
  menuItems = [],
  placeholder,
  footer,
}: CommentRowProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const { colors, typography, spacing } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const metaStyle = {
    color: colors.text.secondary,
    fontSize: typography.bodyMeta.fontSize,
    lineHeight: typography.bodyMeta.lineHeight,
  } as const;

  if (placeholder) {
    return (
      <Indented on={isReply} testID={`${testIDPrefix}-indent-${id}`}>
        <View testID={`${testIDPrefix}-${id}`} style={styles.placeholder}>
          <Text style={[metaStyle, { fontStyle: "italic" }]} testID={placeholder.testID}>
            {placeholder.text}
          </Text>
        </View>
      </Indented>
    );
  }

  const isOfficial = (author.roles ?? []).some((role) => role.role === "official");
  const name = isOfficial ? t("eventHub.officialName") : author.name;
  const openProfile = author.username
    ? () => router.push(profileHref(author.username as string))
    : null;
  const avatar = (
    <Avatar
      uri={getAvatarUrl(author.avatarPath)}
      name={name}
      size={isReply ? 28 : 36}
      testID={`${testIDPrefix}-avatar-${id}`}
    />
  );
  const nameText = (
    <Text
      numberOfLines={1}
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
    <Indented on={isReply} testID={`${testIDPrefix}-indent-${id}`}>
      <View
        testID={`${testIDPrefix}-${id}`}
        style={[
          pinned
            ? [
                styles.pinnedCard,
                {
                  backgroundColor: colors.surface.raised,
                  borderColor: colors.border.default,
                  padding: spacing[3],
                  gap: spacing[2],
                },
              ]
            : null,
        ]}
      >
        {pinned ? (
          <View
            style={[styles.headerRow, { gap: spacing[1] }]}
            testID={`${testIDPrefix}-pinned-${id}`}
          >
            <Ionicons name="pin" size={14} color={colors.brand.primary} />
            <Text
              style={[metaStyle, { color: colors.text.secondary, fontWeight: "600" }]}
            >
              {t("eventHub.pin.pinned")}
            </Text>
          </View>
        ) : null}
        <View style={[styles.row, { gap: spacing[3] }]}>
          {openProfile ? (
            <Pressable
              accessibilityRole="link"
              accessibilityLabel={t("community.openProfile", { name })}
              hitSlop={isReply ? 8 : 4}
              onPress={openProfile}
              testID={`${testIDPrefix}-avatar-link-${id}`}
            >
              {avatar}
            </Pressable>
          ) : (
            avatar
          )}
          <View style={styles.content}>
            <View style={[styles.headerRow, { gap: spacing[2] }]}>
              {openProfile ? (
                <Pressable
                  accessibilityRole="link"
                  accessibilityLabel={t("community.openProfile", { name })}
                  hitSlop={{ top: 10, bottom: 10 }}
                  onPress={openProfile}
                  testID={`${testIDPrefix}-name-link-${id}`}
                  style={styles.nameLink}
                >
                  {nameText}
                </Pressable>
              ) : (
                nameText
              )}
              <RoleMark roles={author.roles} explain />
              {following ? (
                <Text style={metaStyle} testID={`${testIDPrefix}-following-${id}`}>
                  {t("eventHub.thread.following")}
                </Text>
              ) : null}
              <Text style={metaStyle}>{`· ${timeText}`}</Text>
            </View>
            {meta ? <Text style={metaStyle}>{meta}</Text> : null}

            <MentionText
              text={body}
              testID={`${testIDPrefix}-body-${id}`}
              style={{
                color: colors.text.primary,
                fontSize: typography.bodyDefault.fontSize,
                lineHeight: typography.bodyDefault.lineHeight,
                textAlign: "auto",
                alignSelf: "stretch",
                flexShrink: 1,
                marginTop: 2,
                ...WRAP_ANYWHERE,
              }}
            />

            {pendingText ? (
              <View
                style={[styles.headerRow, { gap: spacing[1], marginTop: spacing[1] }]}
                testID={`${testIDPrefix}-pending-${id}`}
              >
                <Ionicons name="time-outline" size={14} color={colors.text.secondary} />
                <Text style={[metaStyle, { fontStyle: "italic", flexShrink: 1 }]}>
                  {pendingText}
                </Text>
              </View>
            ) : null}

            {onReply || heart ? (
              <View style={styles.actions}>
                {onReply ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={onReply}
                    hitSlop={4}
                    style={styles.reply}
                    testID={`${testIDPrefix}-reply-${id}`}
                  >
                    <Text style={[metaStyle, { fontWeight: "600" }]}>
                      {t("eventHub.thread.reply")}
                    </Text>
                  </Pressable>
                ) : null}
                {heart ? (
                  <HeartButton {...heart} testID={`${testIDPrefix}-heart-${id}`} />
                ) : null}
              </View>
            ) : null}
            {footer}
          </View>
          {menuItems.length > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("social.more", { name })}
              onPress={() => setMenuOpen(true)}
              hitSlop={4}
              style={styles.more}
              testID={`${testIDPrefix}-more-${id}`}
            >
              <Ionicons
                name="ellipsis-horizontal"
                size={20}
                color={colors.text.secondary}
              />
            </Pressable>
          ) : null}
        </View>
        {menuOpen ? (
          <MenuSheet
            items={menuItems}
            onClose={() => setMenuOpen(false)}
            testID={`${testIDPrefix}-menu-${id}`}
            preview={
              <View style={[styles.previewRow, { gap: spacing[3] }]}>
                <Avatar
                  uri={getAvatarUrl(author.avatarPath)}
                  name={name}
                  size={32}
                  testID={`${testIDPrefix}-menu-avatar-${id}`}
                />
                <Text numberOfLines={2} style={[metaStyle, styles.previewText]}>
                  <Text style={{ color: colors.text.primary, fontWeight: "600" }}>
                    {name}
                  </Text>
                  {body ? ` · ${body}` : ""}
                </Text>
              </View>
            }
          />
        ) : null}
      </View>
    </Indented>
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
  row: { flexDirection: "row", alignItems: "flex-start" },
  content: { flex: 1 },
  headerRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap" },
  nameLink: { flexShrink: 1 },
  actions: { flexDirection: "row", alignItems: "center", marginStart: -6 },
  reply: { minHeight: 44, justifyContent: "center", paddingHorizontal: 6 },
  more: {
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    marginTop: -8,
  },
  pinnedCard: { borderWidth: 1, borderRadius: 12 },
  placeholder: { minHeight: 32, justifyContent: "center" },
  previewRow: { flexDirection: "row", alignItems: "center" },
  previewText: { flex: 1 },
});
