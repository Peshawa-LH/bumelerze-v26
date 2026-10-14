import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { localizeDigits } from "@/lib/format-numbers";
import { useTheme } from "@/theme";

import { ROLE_BADGES } from "../catalog";
import type { BadgeEntry } from "../evaluate";
import { badgeLabels } from "../labels";
import { entryVisual } from "../visual";
import { BadgeGrid } from "./BadgeGrid";
import { BadgeIcon } from "./BadgeIcon";
import { BadgeSheet } from "./BadgeSheet";

export interface EarnedBadgesProps {
  /** The badges to show: earned ones only (the caller filters). */
  entries: readonly BadgeEntry[];
  /** Only the owner passes this: the size of the full collection, which adds
   * "See all (N)" and opens `/badges` (locked badges and requestable ranks).
   * A visitor never gets the link, so locked badges never reach their screen. */
  seeAllCount?: number;
  /** "grid" (the titled block) or "row": one line of small badges and
   * "See all (N)", for the profile header (review note 5.1). */
  variant?: "grid" | "row";
}

/** Badges in the one-line header row. */
const ROW_BADGES = 5;
const ROW_SIZE = 36;

/** The "Badges" block of a profile: earned badges only. The owner also gets
 * "See all (N)" to the full collection. */
export function EarnedBadges({
  entries,
  seeAllCount,
  variant = "grid",
}: EarnedBadgesProps) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { colors, typography, spacing } = useTheme();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const isOwner = seeAllCount !== undefined;
  if (entries.length === 0 && !isOwner) {
    return null;
  }
  if (variant === "row") {
    const selected = entries.find((entry) => entry.key === selectedKey) ?? null;
    return (
      <View
        style={[styles.header, { gap: spacing[2] }]}
        testID="profile-badges"
        accessibilityLabel={t("myData.badges.title")}
      >
        <View style={[styles.row, { gap: spacing[2] }]}>
          {entries.slice(0, ROW_BADGES).map((entry) => {
            const { name } = badgeLabels(entry, t, i18n.language);
            const visual = entryVisual(entry);
            return (
              <Pressable
                key={entry.key}
                testID={`badge-${entry.key}`}
                accessibilityRole="button"
                accessibilityLabel={t("myData.badges.a11yEarned", { name })}
                hitSlop={4}
                onPress={() => setSelectedKey(entry.key)}
                style={styles.rowBadge}
              >
                <BadgeIcon
                  glyph={visual.glyph}
                  mark={entry.kind === "role" && ROLE_BADGES[entry.role].mark}
                  tone={visual.tone}
                  earned={entry.earned}
                  size={ROW_SIZE}
                />
              </Pressable>
            );
          })}
          {entries.length === 0 ? (
            <Text
              testID="badges-none-yet"
              style={[typography.bodyMeta, { color: colors.text.secondary }]}
            >
              {t("myData.badges.noneYet")}
            </Text>
          ) : null}
        </View>
        {isOwner ? (
          <Pressable
            testID="badges-see-all"
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => router.push("/badges")}
            style={styles.link}
          >
            <Text
              style={[
                typography.bodyMeta,
                { color: colors.text.link, fontWeight: "600" },
              ]}
            >
              {t("myData.badges.seeAll", {
                count: localizeDigits(String(seeAllCount), i18n.language),
              })}
            </Text>
          </Pressable>
        ) : null}
        <BadgeSheet entry={selected} onClose={() => setSelectedKey(null)} />
      </View>
    );
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
  row: { flexDirection: "row", alignItems: "center", flexShrink: 1, flexWrap: "wrap" },
  rowBadge: {
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
});
