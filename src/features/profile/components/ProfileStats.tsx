import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { isolateNumeric } from "@/features/events/format";
import { localizeDigits } from "@/lib/format-numbers";
import { useTheme } from "@/theme";

interface Cell {
  key: "posts" | "followers" | "following";
  label: string;
  value: number;
  onPress?: (() => void) | undefined;
}

/**
 * Posts, followers and following beside the profile photo (review note 5.1,
 * mockup 3a): the number above its word. Followers and Following open their
 * lists when the viewer may see them.
 */
export function ProfileStats({
  posts,
  followers,
  following,
  onOpenFollowers,
  onOpenFollowing,
}: {
  posts: number;
  followers: number;
  following: number;
  onOpenFollowers?: (() => void) | undefined;
  onOpenFollowing?: (() => void) | undefined;
}) {
  const { t, i18n } = useTranslation();
  const { colors, typography } = useTheme();
  const cells: Cell[] = [
    { key: "posts", label: t("profile.stats.posts"), value: posts },
    {
      key: "followers",
      label: t("profile.stats.followers"),
      value: followers,
      onPress: onOpenFollowers,
    },
    {
      key: "following",
      label: t("profile.stats.following"),
      value: following,
      onPress: onOpenFollowing,
    },
  ];
  return (
    <View style={styles.row} testID="profile-stats">
      {cells.map((cell) => {
        const number = isolateNumeric(localizeDigits(String(cell.value), i18n.language));
        const content = (
          <>
            <Text style={[typography.h3, styles.number, { color: colors.text.primary }]}>
              {number}
            </Text>
            <Text
              numberOfLines={1}
              style={[
                typography.bodyMeta,
                styles.label,
                { color: colors.text.secondary },
              ]}
            >
              {cell.label}
            </Text>
          </>
        );
        // Spoken without the direction marks the drawn number carries.
        const a11y = t("myData.stats.a11y", {
          label: cell.label,
          count: localizeDigits(String(cell.value), i18n.language),
        });
        return cell.onPress ? (
          <Pressable
            key={cell.key}
            accessibilityRole="button"
            accessibilityLabel={a11y}
            onPress={cell.onPress}
            style={styles.cell}
            testID={`count-${cell.key}`}
          >
            {content}
          </Pressable>
        ) : (
          <View
            key={cell.key}
            accessible
            accessibilityLabel={a11y}
            style={styles.cell}
            testID={`count-${cell.key}`}
          >
            {content}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flex: 1, flexDirection: "row" },
  cell: { flex: 1, minHeight: 56, alignItems: "center", justifyContent: "center" },
  number: { fontVariant: ["tabular-nums"], textAlign: "center" },
  label: { textAlign: "center" },
});
