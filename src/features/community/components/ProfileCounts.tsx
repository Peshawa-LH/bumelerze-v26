import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { localizeDigits } from "@/lib/format-numbers";
import { useTheme } from "@/theme";

export interface ProfileCountsProps {
  /** Felt reports. Null hides the cell (a person who hides their badges also
   * keeps the report count to themselves). */
  reports?: number | null;
  comments?: number | null;
  followers?: number | null;
  following?: number | null;
  onOpenFollowers?: () => void;
  onOpenFollowing?: () => void;
}

interface CountCell {
  key: "reports" | "comments" | "followers" | "following";
  label: string;
  value: number | null;
  onPress?: (() => void) | undefined;
}

/** Reports, Comments, Followers, Following in ONE row (D79); the same row for
 * the owner and for visitors. A figure that is not known (null) leaves its
 * cell out. Followers and Following open their lists when allowed. */
export function ProfileCounts({
  reports = null,
  comments = null,
  followers = null,
  following = null,
  onOpenFollowers,
  onOpenFollowing,
}: ProfileCountsProps) {
  const { t, i18n } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const all: CountCell[] = [
    { key: "reports", label: "myData.stats.reports", value: reports },
    { key: "comments", label: "community.profile.comments", value: comments },
    {
      key: "followers",
      label: "community.profile.followers",
      value: followers,
      onPress: onOpenFollowers,
    },
    {
      key: "following",
      label: "community.profile.following",
      value: following,
      onPress: onOpenFollowing,
    },
  ];
  const cells = all.flatMap((cell) =>
    cell.value === null ? [] : [{ ...cell, value: cell.value }],
  );
  if (cells.length === 0) {
    return null;
  }

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
        const label = t(cell.label);
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
