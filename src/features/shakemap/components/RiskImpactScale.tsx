import { StyleSheet, Text, View } from "react-native";

import { formatApproximate } from "@/lib/format-numbers";
import type { TranslateFn } from "@/features/geo";
import type { Theme } from "@/theme";
import { classifyDamageBand } from "../risk-alert";
import { IMPACT_SCALE_MAX, IMPACT_SCALE_TICKS, logPositionPercent, logSpanPercent } from "../risk-scale";
import { damageBandColor } from "./RiskDamageBandTag";

export interface RiskImpactScaleProps {
  p05: number;
  p50: number;
  p95: number;
  locale: string;
  t: TranslateFn;
  colors: Theme["colors"];
  typography: Theme["typography"];
  spacing: Theme["spacing"];
}

/** The rail's own 4 color bands, as [fromValue, color] boundaries — same
 * thresholds `risk-alert.ts`'s `classifyDamageBand` classifies with, so
 * the rail's coloring and the band pill above it can never disagree about
 * where green ends and yellow begins. */
function railSegments(colors: Theme["colors"]): { fromValue: number; color: string }[] {
  return [
    { fromValue: 10, color: damageBandColor("green", colors) },
    { fromValue: 100, color: damageBandColor("yellow", colors) },
    { fromValue: 1_000, color: damageBandColor("orange", colors) },
    { fromValue: 10_000, color: damageBandColor("red", colors) },
  ];
}

/**
 * A slim gradient rail (log scale, 10 to 1,000,000 heavily-damaged
 * buildings) with a dot marker at the P50 and a translucent range pill
 * spanning P05 to P95 — the owner's PAGER-style "impact scale" ask,
 * redrawn as Bumelerze's own visual (soft rounded rail + dot + pill, never
 * PAGER's histogram-bar look).
 */
export function RiskImpactScale({
  p05,
  p50,
  p95,
  locale,
  t,
  colors,
  typography,
  spacing,
}: RiskImpactScaleProps) {
  const band = classifyDamageBand(p50);
  const a11yLabel = t("eventDetail.risk.impactScale.a11yLabel", {
    band: t(`eventDetail.risk.band.${band}.title`),
    p50: formatApproximate(p50, locale, t),
    p05: formatApproximate(p05, locale, t),
    p95: formatApproximate(p95, locale, t),
  });

  const rangeLeft = logPositionPercent(p05);
  const rangeWidth = logSpanPercent(p05, p95);
  const dotLeft = logPositionPercent(p50);
  const segments = railSegments(colors);

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
        {t("eventDetail.risk.impactScale.title")}
      </Text>
      <View
        testID="risk-impact-scale"
        accessible
        accessibilityLabel={a11yLabel}
        // Same "a scientific magnitude axis never mirrors under RTL" rule
        // the SHAKEmap legend strips already establish
        // (`ShakeMapLegend.tsx`) — low-to-high always reads left to right
        // here regardless of locale.
        style={{ gap: spacing[1], direction: "ltr" }}
      >
        <View style={styles.railTrack}>
          {segments.map((segment, index) => {
            const next = segments[index + 1];
            const toValue = next ? next.fromValue : IMPACT_SCALE_MAX;
            return (
              <View
                key={segment.fromValue}
                testID={`risk-impact-scale-segment-${segment.fromValue}`}
                style={[
                  styles.railSegment,
                  {
                    left: logPositionPercent(segment.fromValue),
                    width: logSpanPercent(segment.fromValue, toValue),
                    backgroundColor: segment.color,
                  },
                ]}
              />
            );
          })}
          {/* Translucent P05-P95 whisker — a lighter "range" pill drawn on
           * top of the colored rail. */}
          <View
            testID="risk-impact-scale-range"
            style={[
              styles.rangePill,
              {
                left: rangeLeft,
                width: rangeWidth,
                backgroundColor: colors.surface.overlay,
              },
            ]}
          />
          {/* P50 marker dot. */}
          <View
            testID="risk-impact-scale-marker"
            style={[
              styles.marker,
              {
                left: dotLeft,
                backgroundColor: colors.text.inverse,
                borderColor: colors.text.primary,
              },
            ]}
          />
        </View>
        <View style={styles.tickRow}>
          {IMPACT_SCALE_TICKS.map((tick) => (
            <Text
              key={tick.value}
              style={{
                position: "absolute",
                left: logPositionPercent(tick.value),
                transform: [{ translateX: -8 }],
                color: colors.text.tertiary,
                fontSize: 9,
                fontWeight: "600",
              }}
            >
              {tick.label}
            </Text>
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  railTrack: {
    height: 10,
    borderRadius: 999,
    overflow: "hidden",
    position: "relative",
  },
  railSegment: {
    position: "absolute",
    top: 0,
    bottom: 0,
  },
  rangePill: {
    position: "absolute",
    top: 0,
    bottom: 0,
    borderRadius: 999,
  },
  marker: {
    position: "absolute",
    top: -3,
    width: 16,
    height: 16,
    marginLeft: -8,
    borderRadius: 8,
    borderWidth: 2,
  },
  tickRow: {
    height: 14,
    position: "relative",
  },
});
