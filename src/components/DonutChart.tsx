import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import Svg, { Circle } from "react-native-svg";

import { isolateNumeric } from "@/features/events";
import { localizeDigits } from "@/lib/format-numbers";
import { roundToWhole100 } from "@/lib/percent";
import { useTheme } from "@/theme";

export interface DonutSlice {
  key: string;
  /** Any non-negative quantity; only the shares matter. Zero slices are
   * dropped. */
  value: number;
  color: string;
  label: string;
  /** Replaces the computed percent in the legend and the accessible label
   * (e.g. a band that has buildings but rounds to under one percent). */
  valueText?: string;
}

export interface DonutChartProps {
  slices: readonly DonutSlice[];
  /** Outer diameter in px. */
  size?: number;
  /** Short text in the hole, e.g. the total. */
  centerText?: string;
  /** Names the chart in the accessible label ("What people felt"). */
  title?: string;
  /** Legend rows, "other" bucket included. */
  maxLegendRows?: number;
  testID?: string;
}

const DEFAULT_SIZE = 110;
const DEFAULT_LEGEND_ROWS = 4;
/** Share of the radius taken by the ring. */
const RING_FRACTION = 0.22;

/**
 * Collapses everything beyond the largest `maxRows - 1` slices into one
 * trailing "other" slice, so the legend never outgrows its card. Slices keep
 * their original order. Exported for tests.
 */
export function capSlices(
  slices: readonly DonutSlice[],
  maxRows: number,
  other: { label: string; color: string },
): DonutSlice[] {
  const live = slices.filter((slice) => slice.value > 0);
  if (live.length <= maxRows) {
    return live;
  }
  const keepCount = Math.max(1, maxRows - 1);
  const keepKeys = new Set(
    [...live]
      .sort((a, b) => b.value - a.value)
      .slice(0, keepCount)
      .map((slice) => slice.key),
  );
  const kept = live.filter((slice) => keepKeys.has(slice.key));
  const rest = live.filter((slice) => !keepKeys.has(slice.key));
  return [
    ...kept,
    {
      key: "other",
      value: rest.reduce((sum, slice) => sum + slice.value, 0),
      color: other.color,
      label: other.label,
    },
  ];
}

/**
 * A small donut (ring) chart with a compact legend. Percentages are whole
 * numbers that always add to 100, and a slice with something in it never
 * reads as 0%.
 *
 * RTL: the ring is drawn left-to-right in every locale (a ring has no
 * reading direction worth mirroring, and it keeps the first slice at 12
 * o'clock clockwise); the legend uses logical row layout, so the swatch sits
 * on the reading-start side.
 */
export function DonutChart({
  slices,
  size = DEFAULT_SIZE,
  centerText,
  title,
  maxLegendRows = DEFAULT_LEGEND_ROWS,
  testID,
}: DonutChartProps) {
  const { t, i18n } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const locale = i18n.language;

  const shown = capSlices(slices, maxLegendRows, {
    label: t("donut.other"),
    color: colors.text.tertiary,
  });
  const total = shown.reduce((sum, slice) => sum + slice.value, 0);
  if (total <= 0) {
    return null;
  }

  const percents = roundToWhole100(shown.map((slice) => (slice.value / total) * 100));
  const rows = shown.map((slice, index) => {
    const percent = percents[index] ?? 0;
    const valueText =
      slice.valueText ??
      t("donut.percent", {
        value: percent === 0 ? t("donut.underOne") : localizeDigits(String(percent), locale),
      });
    return { ...slice, valueText };
  });

  const summary = rows
    .map((row) => t("donut.a11ySlice", { label: row.label, value: row.valueText }))
    .join(" ");
  const accessibilityLabel = title ? `${title}. ${summary}` : summary;

  const stroke = Math.round((size / 2) * RING_FRACTION * 2);
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;
  const starts: number[] = [];
  let running = 0;
  for (const row of rows) {
    starts.push(running);
    running += (row.value / total) * circumference;
  }

  const captionStyle = {
    color: colors.text.secondary,
    fontSize: typography.labelCaption.fontSize,
    lineHeight: typography.labelCaption.lineHeight,
  } as const;

  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
      style={{ gap: spacing[3], alignItems: "center" }}
    >
      <View style={[styles.ring, { width: size, height: size, direction: "ltr" }]}>
        <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <Circle
            cx={center}
            cy={center}
            r={radius}
            stroke={colors.surface.sunken}
            strokeWidth={stroke}
            fill="none"
          />
          {rows.map((row, index) => {
            const length = (row.value / total) * circumference;
            const dashOffset = -(starts[index] ?? 0);
            return (
              <Circle
                key={row.key}
                testID={`donut-slice-${row.key}`}
                cx={center}
                cy={center}
                r={radius}
                stroke={row.color}
                strokeWidth={stroke}
                strokeDasharray={`${length} ${circumference - length}`}
                strokeDashoffset={dashOffset}
                fill="none"
                transform={`rotate(-90 ${center} ${center})`}
              />
            );
          })}
        </Svg>
        {centerText ? (
          <View style={[styles.center, { padding: stroke }]} pointerEvents="none">
            <Text
              testID="donut-center"
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.6}
              style={{
                color: colors.text.primary,
                fontSize: typography.bodyMeta.fontSize,
                lineHeight: typography.bodyMeta.lineHeight,
                fontWeight: "700",
                textAlign: "center",
              }}
            >
              {centerText}
            </Text>
          </View>
        ) : null}
      </View>

      <View style={[styles.legend, { gap: spacing[1] }]}>
        {rows.map((row) => (
          <View key={row.key} style={[styles.legendRow, { gap: spacing[2] }]}>
            <View
              style={[
                styles.swatch,
                { backgroundColor: row.color, borderColor: colors.border.default },
              ]}
            />
            <Text style={[captionStyle, styles.legendLabel]} numberOfLines={2}>
              {row.label}
            </Text>
            <Text style={[captionStyle, { color: colors.text.primary }]}>
              {isolateNumeric(row.valueText)}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  ring: {
    alignItems: "center",
    justifyContent: "center",
  },
  center: {
    position: "absolute",
    top: 0,
    bottom: 0,
    start: 0,
    end: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  legend: {
    alignSelf: "stretch",
  },
  legendRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  swatch: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: StyleSheet.hairlineWidth,
  },
  legendLabel: {
    flex: 1,
  },
});
