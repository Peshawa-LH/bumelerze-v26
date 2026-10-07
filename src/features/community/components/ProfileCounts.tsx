import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { localizeDigits } from "@/lib/format-numbers";
import { useTheme } from "@/theme";

export interface ProfileCountsProps {
  followers: number;
  following: number;
  comments: number;
  helpful: number;
  onOpenFollowers?: () => void;
  onOpenFollowing?: () => void;
}

/** Followers, Following, Comments, Helpful in one card. The first two open
 * their lists when the viewer is allowed to see them. */
export function ProfileCounts({
  followers,
  following,
  comments,
  helpful,
  onOpenFollowers,
  onOpenFollowing,
}: ProfileCountsProps) {
  const { t, i18n } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const cells = [
    { key: "followers", value: followers, onPress: onOpenFollowers },
    { key: "following", value: following, onPress: onOpenFollowing },
    { key: "comments", value: comments, onPress: undefined },
    { key: "helpful", value: helpful, onPress: undefined },
  ] as const;

  return (
    <View
      testID="profile-counts"
      style={[
        styles.card,
        { backgroundColor: colors.surface.raised, borderColor: colors.border.default },
      ]}
    >
      {cells.map((cell, index) => {
        const number = localizeDigits(String(cell.value), i18n.language);
        const label = t(`community.profile.${cell.key}`);
        const content = (
          <>
            <Text
              style={[
                typography.h2,
                styles.number,
                { color: colors.text.primary, writingDirection: "ltr" },
              ]}
            >
              {number}
            </Text>
            <Text
              numberOfLines={2}
              style={[
                typography.bodyMeta,
                styles.label,
                { color: colors.text.secondary },
              ]}
            >
              {label}
            </Text>
          </>
        );
        const cellStyle = [
          styles.cell,
          {
            paddingVertical: spacing[3],
            borderEndWidth: index < cells.length - 1 ? 1 : 0,
            borderColor: colors.border.subtle,
          },
        ];
        return cell.onPress ? (
          <Pressable
            key={cell.key}
            testID={`count-${cell.key}`}
            accessibilityRole="button"
            accessibilityLabel={t("myData.stats.a11y", { label, count: number })}
            onPress={cell.onPress}
            style={cellStyle}
          >
            {content}
          </Pressable>
        ) : (
          <View
            key={cell.key}
            testID={`count-${cell.key}`}
            accessible
            accessibilityLabel={t("myData.stats.a11y", { label, count: number })}
            style={cellStyle}
          >
            {content}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: "row", borderWidth: 1, borderRadius: 14, overflow: "hidden" },
  cell: {
    flex: 1,
    minHeight: 76,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  number: { fontVariant: ["tabular-nums"], textAlign: "center" },
  label: { textAlign: "center" },
});
