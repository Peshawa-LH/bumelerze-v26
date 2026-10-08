import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { localizeDigits } from "@/lib/format-numbers";
import { useTheme } from "@/theme";

import type { BadgeEntry } from "../evaluate";
import { BadgeGrid } from "./BadgeGrid";

export interface EarnedBadgesProps {
  /** The badges to show: earned ones only (the caller filters). */
  entries: readonly BadgeEntry[];
  /** Only the owner passes this: the size of the full collection, which adds
   * "See all (N)" and opens `/badges` (locked badges and requestable ranks).
   * A visitor never gets the link, so locked badges never reach their screen. */
  seeAllCount?: number;
}

/** The "Badges" block of a profile: earned badges only. The owner also gets
 * "See all (N)" to the full collection. */
export function EarnedBadges({ entries, seeAllCount }: EarnedBadgesProps) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { colors, typography, spacing } = useTheme();
  const isOwner = seeAllCount !== undefined;
  if (entries.length === 0 && !isOwner) {
    return null;
  }
  return (
    <View style={{ gap: spacing[2] }} testID="profile-badges">
      <View style={[styles.header, { gap: spacing[2] }]}>
        <Text
          accessibilityRole="header"
          style={[typography.h3, { color: colors.text.primary }]}
        >
          {t("myData.badges.title")}
        </Text>
        {isOwner ? (
          <Pressable
            testID="badges-see-all"
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => router.push("/badges")}
            style={styles.link}
          >
            <Text style={[typography.labelButton, { color: colors.text.link }]}>
              {t("myData.badges.seeAll", {
                count: localizeDigits(String(seeAllCount), i18n.language),
              })}
            </Text>
          </Pressable>
        ) : null}
      </View>
      {entries.length > 0 ? (
        <BadgeGrid entries={entries} />
      ) : (
        <Text
          testID="badges-none-yet"
          style={[typography.bodyMeta, { color: colors.text.secondary }]}
        >
          {t("myData.badges.noneYet")}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  link: { minHeight: 44, justifyContent: "center" },
});
