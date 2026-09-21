import { StyleSheet, Text, View } from "react-native";

import type { TranslateFn } from "@/features/geo";
import { localizeDigits } from "@/lib/format-numbers";
import type { Theme } from "@/theme";

export interface RiskDamageGradeBarProps {
  buildingsInGrid: number;
  buildingsHeavy: number;
  buildingsDg4Plus: number;
  /** DG0..DG5 counts from product schema 2. When present the bar splits
   * moderate damage (DG2) out of "little or no damage", which is where
   * most of the damage in a real event actually sits. `null` for every
   * version published before schema 2, and then the bar falls back to the
   * three buckets it has always drawn. */
  buildingsByGrade?: readonly number[] | null;
  locale: string;
  t: TranslateFn;
  colors: Theme["colors"];
  typography: Theme["typography"];
  spacing: Theme["spacing"];
}

interface Segment {
  key: "little" | "moderate" | "heavy" | "severe";
  percent: number;
  /** True when this band has buildings in it but rounds to zero percent.
   * At national scale real damage is a fraction of a percent of the whole
   * stock: on the 2017 event 24,511 heavily damaged buildings out of 7.8
   * million rounds to 0, and a legend reading "Heavy damage (0%)" over an
   * event that wrecked thousands of homes is false. Such a band is
   * labelled "less than 1" instead. */
  underOnePercent: boolean;
  color: string;
}

/** Rounds each raw fraction to a whole percent, then nudges the LARGEST
 * segment so they sum to exactly 100 — independently-rounded
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
 * A single rounded bar split into damage bands over 100% of the
 * buildings in the exposure grid, with a legend below: "little or no
 * damage" / "moderate damage" (DG2, schema 2 only) / "heavy damage"
 * (DG3) / "very heavy damage or collapse" (DG4/DG5).
 * Percentages only, rounded to whole numbers; no raw building counts here
 * at all (owner: "no raw numbers" for this bar specifically — the
 * exposure tiles above already cover the approximate absolute figures).
 */
export function RiskDamageGradeBar({
  buildingsInGrid,
  buildingsHeavy,
  buildingsDg4Plus,
  buildingsByGrade,
  locale,
  t,
  colors,
  typography,
  spacing,
}: RiskDamageGradeBarProps) {
  if (buildingsInGrid <= 0) {
    return null;
  }

  // Schema 2 gives DG0..DG5, so DG2 gets its own segment: in a real event
  // moderate damage is where most of the affected stock sits, and folding
  // it into "little or no damage" made the bar say almost nothing
  // happened. Without it, the original three buckets.
  const grades = buildingsByGrade && buildingsByGrade.length === 6 ? buildingsByGrade : null;
  const moderate = grades ? Math.max(0, grades[2] ?? 0) : 0;
  const little = Math.max(0, buildingsInGrid - buildingsHeavy - moderate);
  const heavy = Math.max(0, buildingsHeavy - buildingsDg4Plus);
  const severe = Math.max(0, buildingsDg4Plus);

  const rawPercents = [
    (little / buildingsInGrid) * 100,
    (moderate / buildingsInGrid) * 100,
    (heavy / buildingsInGrid) * 100,
    (severe / buildingsInGrid) * 100,
  ];
  const [littlePercent, moderatePercent, heavyPercent, severePercent] = roundToWhole100(rawPercents);

  const under = (rounded: number | undefined, raw: number | undefined) =>
    (rounded ?? 0) === 0 && (raw ?? 0) > 0;
  const allSegments: Segment[] = [
    { key: "little", percent: littlePercent ?? 0, underOnePercent: under(littlePercent, rawPercents[0]), color: colors.damageGrade[1] ?? colors.status.success },
    { key: "moderate", percent: moderatePercent ?? 0, underOnePercent: under(moderatePercent, rawPercents[1]), color: colors.damageGrade[2] ?? colors.status.warning },
    { key: "heavy", percent: heavyPercent ?? 0, underOnePercent: under(heavyPercent, rawPercents[2]), color: colors.damageGrade[3] ?? colors.status.warning },
    { key: "severe", percent: severePercent ?? 0, underOnePercent: under(severePercent, rawPercents[3]), color: colors.damageGrade[5] ?? colors.status.danger },
  ];
  const segments = grades ? allSegments : allSegments.filter((seg) => seg.key !== "moderate");

  const a11yLabel = segments
    .map((segment) =>
      t("eventDetail.risk.stackedBar.a11ySegment", {
        label: t(`eventDetail.risk.stackedBar.${segment.key}`),
        percent: percentText(segment, locale, t),
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
                percent: percentText(segment, locale, t),
              })}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/** The number that goes inside the locale's own percent string. A band
 * that has buildings in it never reads as zero. */
function percentText(segment: Segment, locale: string, t: TranslateFn): string {
  if (segment.underOnePercent) {
    return t("eventDetail.risk.stackedBar.underOnePercent");
  }
  return localizeDigits(String(segment.percent), locale);
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
