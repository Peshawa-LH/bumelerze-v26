import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { isolateNumeric } from "@/features/events/format";
import { localizeDigits } from "@/lib/format-numbers";
import { useTheme } from "@/theme";
import { HeartButton, type HeartButtonProps } from "./HeartButton";

export interface ActionRowProps {
  heart?: Omit<HeartButtonProps, "size" | "testID"> | undefined;
  /** The comment count; tapping it jumps to the conversation. */
  comments?: { count: number; onPress?: (() => void) | undefined } | undefined;
  /** The Event hub only: "N felt it", which opens Share your experience. */
  felt?: { label: string; onPress: () => void } | undefined;
  onShare?: (() => void) | undefined;
  testID?: string;
}

/**
 * One row under a post (the Event hub is a post too): heart, comments, the
 * hub's "N felt it" pill, and share at the far end. A plain flex row, so it
 * mirrors by itself in Sorani and Arabic (share at the far left).
 */
export function ActionRow({
  heart,
  comments,
  felt,
  onShare,
  testID = "action-row",
}: ActionRowProps) {
  const { t, i18n } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const number = (value: number) =>
    isolateNumeric(localizeDigits(String(value), i18n.language));

  const commentContent = comments ? (
    <>
      <Ionicons
        name="chatbubble-outline"
        size={24}
        color={colors.text.secondary}
        accessibilityElementsHidden
        importantForAccessibility="no"
      />
      {comments.count > 0 ? (
        <Text
          style={[typography.labelButton, styles.count, { color: colors.text.secondary }]}
        >
          {number(comments.count)}
        </Text>
      ) : null}
    </>
  ) : null;

  return (
    <View style={[styles.row, { gap: spacing[1] }]} testID={testID}>
      {heart ? <HeartButton {...heart} size="large" testID={`${testID}-heart`} /> : null}
      {comments ? (
        comments.onPress ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("social.comments.label", {
              number: number(comments.count),
            })}
            onPress={comments.onPress}
            hitSlop={4}
            style={styles.button}
            testID={`${testID}-comments`}
          >
            {commentContent}
          </Pressable>
        ) : (
          <View
            accessible
            accessibilityLabel={t("social.comments.label", {
              number: number(comments.count),
            })}
            style={styles.button}
            testID={`${testID}-comments`}
          >
            {commentContent}
          </View>
        )
      ) : null}
      {felt ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={felt.label}
          accessibilityHint={t("eventHub.post.feltHint")}
          onPress={felt.onPress}
          hitSlop={4}
          testID={`${testID}-felt`}
          style={({ pressed }) => [
            styles.felt,
            {
              borderColor: colors.action.felt,
              backgroundColor: pressed ? colors.surface.sunken : "transparent",
              paddingHorizontal: spacing[3],
              marginStart: spacing[1],
            },
          ]}
        >
          <Ionicons
            name="pulse"
            size={18}
            color={colors.action.felt}
            accessibilityElementsHidden
            importantForAccessibility="no"
          />
          <Text
            style={[typography.labelButton, { color: colors.text.primary }]}
            numberOfLines={1}
          >
            {felt.label}
          </Text>
        </Pressable>
      ) : null}
      <View style={styles.spacer} />
      {onShare ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("social.share")}
          onPress={onShare}
          hitSlop={4}
          style={styles.button}
          testID={`${testID}-share`}
        >
          <Ionicons name="share-outline" size={24} color={colors.text.secondary} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", minHeight: 48 },
  button: {
    minHeight: 44,
    minWidth: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 6,
  },
  count: { fontVariant: ["tabular-nums"] },
  felt: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1.5,
    borderRadius: 999,
  },
  spacer: { flex: 1 },
});
