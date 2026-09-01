import { StyleSheet, Text, View } from "react-native";

import type { TranslateFn } from "@/features/geo";
import { localizeDigits } from "@/lib/format-numbers";
import type { Theme } from "@/theme";

export interface RiskDamageGradeBarProps {
  buildingsInGrid: number;
  buildingsHeavy: number;
  buildingsDg4Plus: number;
  locale: string;
  t: TranslateFn;
  colors: Theme["colors"];
  typography: Theme["typography"];
  spacing: Theme["spacing"];
}

interface Segment {
  key: "little" | "heavy" | "severe";
  percent: number;
  color: string;
}

/** Rounds each raw fraction to a whole percent, then nudges the LARGEST
 * segment so the three sum to exactly 100 — three independently-rounded
 * percentages can land on 99 or 101 (e.g. 33/33/34 raw -> 33/33/33
 * rounds to 99), and a stacked bar whose segments don't sum to 100 either
 * leaves a visible gap or overflows its own container. */
function roundToWhole100(rawPercents: readonly number[]): number[] {
  const rounded = rawPercents.map((value) => Math.round(value));
  const total = rounded.reduce((sum, value) => sum + value, 0);
  const diff = 100 - total;
  if (diff === 0 || rounded.length === 0) {
    return rounded;
  }
  const largestIndex = rounded.indexOf(Math.max(...rounded));
  rounded[largestIndex] = (rounded[largestIndex] ?? 0) + diff;
  return rounded;
}

/**
 * A single rounded bar split into three damage bands over 100% of the
 * buildings in the exposure grid — "little or no damage" / "heavy damage"
 * (DG3) / "very heavy damage or collapse" (DG4/DG5) — with a legend below.
 * Percentages only, rounded to whole numbers; no raw building counts here
 * at all (owner: "no raw numbers" for this bar specifically — the
 * exposure tiles above already cover the approximate absolute figures).
 */
export function RiskDamageGradeBar({
  buildingsInGrid,
  buildingsHeavy,
  buildingsDg4Plus,
  locale,
  t,
  colors,
  typography,
  spacing,
}: RiskDamageGradeBarProps) {
  if (buildingsInGrid <= 0) {
    return null;
  }

  const little = Math.max(0, buildingsInGrid - buildingsHeavy);
  const heavy = Math.max(0, buildingsHeavy - buildingsDg4Plus);
  const severe = Math.max(0, buildingsDg4Plus);

  const [littlePercent, heavyPercent, severePercent] = roundToWhole100([
    (little / buildingsInGrid) * 100,
    (heavy / buildingsInGrid) * 100,
    (severe / buildingsInGrid) * 100,
  ]);

  const segments: Segment[] = [
    { key: "little", percent: littlePercent ?? 0, color: colors.damageGrade[1] ?? colors.status.success },
    { key: "heavy", percent: heavyPercent ?? 0, color: colors.damageGrade[3] ?? colors.status.warning },
    { key: "severe", percent: severePercent ?? 0, color: colors.damageGrade[5] ?? colors.status.danger },
  ];

  const a11yLabel = segments
    .map((segment) =>
      t("eventDetail.risk.stackedBar.a11ySegment", {
        label: t(`eventDetail.risk.stackedBar.${segment.key}`),
        percent: localizeDigits(String(segment.percent), locale),
      }),
    )
    .join(" ");

  return (
    <View style={{ gap: spacing[2] }}>
      <Text
        style={{
          color: colors.text.secondary,
          fontSize: typography.labelCaption.fontSize,
          lineHeight: typography.labelCaption.lineHeight,
          fontWeight: typography.labelCaption.fontWeight,
        }}
      >
        {t("eventDetail.risk.stackedBar.title")}
      </Text>
      <View
        testID="risk-damage-grade-bar"
        accessible
        accessibilityLabel={a11yLabel}
        // Same non-mirroring rule as the impact scale/SHAKEmap legend —
        // little-to-severe always reads left to right regardless of
        // locale.
        style={[styles.track, { direction: "ltr" }]}
      >
        {segments
          .filter((segment) => segment.percent > 0)
          .map((segment) => (
            <View
              key={segment.key}
              testID={`risk-damage-grade-bar-${segment.key}`}
              style={{ flexGrow: segment.percent, backgroundColor: segment.color }}
            />
          ))}
      </View>
      <View style={[styles.legendRow, { gap: spacing[3] }]}>
        {segments.map((segment) => (
          <View key={segment.key} style={styles.legendItem}>
            <View style={[styles.legendSwatch, { backgroundColor: segment.color }]} />
            <Text
              style={{
                color: colors.text.secondary,
                fontSize: typography.labelCaption.fontSize,
                lineHeight: typography.labelCaption.lineHeight,
              }}
            >
              {t("eventDetail.risk.stackedBar.legendItem", {
                label: t(`eventDetail.risk.stackedBar.${segment.key}`),
                percent: localizeDigits(String(segment.percent), locale),
              })}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: "row",
    height: 14,
    borderRadius: 999,
    overflow: "hidden",
  },
  legendRow: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  legendSwatch: {
    width: 10,
    height: 10,
    borderRadius: 3,
  },
});
