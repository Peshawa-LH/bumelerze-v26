import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { localizeDigits } from "@/lib/format-numbers";
import { useTheme } from "@/theme";

import { ROLE_BADGES } from "../catalog";
import type { BadgeEntry } from "../evaluate";
import { badgeLabels } from "../labels";
import { BadgeIcon } from "./BadgeIcon";
import { entryVisual } from "../visual";
import { BadgeSheet } from "./BadgeSheet";

/** Badge circle size on the page. */
export const BADGE_SIZE = 52;
const COLUMNS = 5;

/** The collection: five columns of badges (role badges first), each opening
 * the detail sheet. Cells mirror in RTL with the row direction. */
export function BadgeGrid({ entries }: { entries: readonly BadgeEntry[] }) {
  const { t, i18n } = useTranslation();
  const { colors, spacing } = useTheme();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const selected = entries.find((entry) => entry.key === selectedKey) ?? null;

  return (
    <View
      testID="badge-grid"
      style={[
        styles.grid,
        {
          backgroundColor: colors.surface.raised,
          borderColor: colors.border.default,
          padding: spacing[3],
        },
      ]}
    >
      {entries.map((entry) => {
        const { name } = badgeLabels(entry, t, i18n.language);
        const visual = entryVisual(entry);
        const label = entry.earned
          ? t("myData.badges.a11yEarned", { name })
          : t("myData.badges.a11yLocked", {
              name,
              current: localizeDigits(
                String(entry.kind === "milestone" ? entry.current : 0),
                i18n.language,
              ),
              target: localizeDigits(
                String(entry.kind === "milestone" ? entry.target : 0),
                i18n.language,
              ),
            });
        return (
          <View key={entry.key} style={styles.cell}>
            <Pressable
              testID={`badge-${entry.key}`}
              accessibilityRole="button"
              accessibilityLabel={label}
              accessibilityState={{ disabled: false }}
              hitSlop={4}
              onPress={() => setSelectedKey(entry.key)}
              style={({ pressed }) => [
                styles.press,
                { backgroundColor: pressed ? colors.surface.sunken : "transparent" },
              ]}
            >
              <BadgeIcon
                glyph={visual.glyph}
                mark={entry.kind === "role" && ROLE_BADGES[entry.role].mark}
                tone={visual.tone}
                earned={entry.earned}
                size={BADGE_SIZE}
              />
            </Pressable>
          </View>
        );
      })}
      <BadgeSheet entry={selected} onClose={() => setSelectedKey(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    borderWidth: 1,
    borderRadius: 14,
  },
  cell: {
    width: `${100 / COLUMNS}%`,
    alignItems: "center",
    paddingVertical: 6,
  },
  press: {
    minWidth: 44,
    minHeight: 44,
    borderRadius: BADGE_SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
  },
});
