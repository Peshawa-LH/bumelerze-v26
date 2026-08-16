import { Image } from "expo-image";
import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { DAMAGE_ARTWORK, LEVEL_ARTWORK } from "@/features/felt";
import { useTheme } from "@/theme";
import type { ContributionRowViewModel } from "../format";

interface ContributionRowProps {
  row: ContributionRowViewModel;
}

/**
 * One My Data list row (D26 item 7 wave brief): date, event (if the report
 * is attached to one), felt level with its artwork thumbnail, damage grade
 * with its own thumbnail when window 2 was answered, and sync status.
 * Read-only — unlike `LevelTile`/`DamageTile` (the felt-report FLOW's own
 * tappable tiles this reuses artwork from), nothing here is a `Pressable`:
 * a past contribution has no further action to take on it in this v1 (wave
 * brief: "NO badges/gamification (future)" — this extends to "no
 * re-open/edit" too, out of scope here).
 */
export function ContributionRow({ row }: ContributionRowProps) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.surface.raised,
          borderColor: colors.border.default,
          padding: spacing[3],
          gap: spacing[2],
        },
      ]}
    >
      <View style={styles.topRow}>
        <Text
          style={{
            color: colors.text.secondary,
            fontSize: typography.labelCaption.fontSize,
            lineHeight: typography.labelCaption.lineHeight,
          }}
        >
          {row.dateText}
        </Text>
        <Text
          style={{
            color:
              row.syncStatus === "submitted" ? colors.status.success : colors.text.tertiary,
            fontSize: typography.labelCaption.fontSize,
            lineHeight: typography.labelCaption.lineHeight,
            fontWeight: "600",
          }}
        >
          {row.syncStatusText}
        </Text>
      </View>

      <Text
        style={{
          color: colors.text.primary,
          fontSize: typography.bodyDefault.fontSize,
          lineHeight: typography.bodyDefault.lineHeight,
          fontWeight: "600",
        }}
      >
        {row.eventLabel ?? t("myData.unassignedEvent")}
      </Text>

      <View style={[styles.itemRow, { gap: spacing[2] }]}>
        <Image
          testID="mydata-level-artwork"
          source={LEVEL_ARTWORK[row.level]}
          contentFit="cover"
          style={styles.thumb}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
        <Text
          allowFontScaling
          style={{
            flex: 1,
            color: colors.text.primary,
            fontSize: typography.bodyMeta.fontSize,
            lineHeight: typography.bodyMeta.lineHeight,
          }}
        >
          {row.levelLabel}
        </Text>
      </View>

      {row.damage ? (
        <View style={[styles.itemRow, { gap: spacing[2] }]}>
          <Image
            testID="mydata-damage-artwork"
            source={DAMAGE_ARTWORK[row.damage.typology][row.damage.grade]}
            contentFit="cover"
            style={styles.thumb}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          />
          <Text
            allowFontScaling
            style={{
              flex: 1,
              color: colors.text.secondary,
              fontSize: typography.bodyMeta.fontSize,
              lineHeight: typography.bodyMeta.lineHeight,
            }}
          >
            {t("myData.damageLine", {
              typology: row.damage.typologyLabel,
              grade: row.damage.label,
            })}
          </Text>
        </View>
      ) : null}

      {row.hasPhoto ? (
        <Text
          style={{
            color: colors.text.tertiary,
            fontSize: typography.labelCaption.fontSize,
            lineHeight: typography.labelCaption.lineHeight,
          }}
        >
          {t("myData.photoAttachedLabel")}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 12,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  thumb: {
    width: 40,
    height: 40,
    borderRadius: 8,
  },
});
