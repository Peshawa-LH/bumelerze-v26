import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { localizeDigits } from "@/lib/format-numbers";
import { useTheme } from "@/theme";

import type { BadgeEntry } from "../evaluate";
import { BadgeGrid } from "./BadgeGrid";

/** "Badges 5/9" and the collection grid. The counter counts milestone badges
 * only; role badges (held by a few) are extra and never a denominator. */
export function BadgesSection({
  entries,
  earned,
  total,
  defaultExpanded = false,
}: {
  entries: readonly BadgeEntry[];
  earned: number;
  total: number;
  defaultExpanded?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const counter = `${localizeDigits(String(earned), i18n.language)}/${localizeDigits(String(total), i18n.language)}`;
  return (
    <View style={{ gap: spacing[2] }} testID="badges-section">
      <View style={[styles.header, { gap: spacing[2] }]}>
        <Text
          accessibilityRole="header"
          style={[typography.h3, { color: colors.text.primary }]}
        >
          {t("myData.badges.title")}
        </Text>
        <Text
          testID="badges-counter"
          style={[
            typography.bodyMeta,
            styles.counter,
            { color: colors.text.secondary, writingDirection: "ltr" },
          ]}
        >
          {counter}
        </Text>
      </View>
      <BadgeGrid entries={entries} defaultExpanded={defaultExpanded} />
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
  },
  counter: { fontVariant: ["tabular-nums"] },
});
