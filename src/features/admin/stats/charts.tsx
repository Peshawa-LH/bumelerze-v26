import type { TFunction } from "i18next";
import { useState } from "react";
import { StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import { useTranslation } from "react-i18next";
import Svg, { Line, Polyline, Rect } from "react-native-svg";

import { VC_COLORS } from "@/features/building/components/VcBadge";
import type { VulnerabilityClass } from "@/features/building/ims25";
import { isolateNumeric } from "@/features/events/format";
import { localizeDigits } from "@/lib/format-numbers";
import { useTheme, nativeFontFamily } from "@/theme";
import { useTextDir } from "../ui/text-dir";

/** "14 Sep" from "2026-09-14", digits in the reader's script. */
export function dayMonth(date: string, locale: string, t: TFunction): string {
  const [, m, d] = date.split("-");
  const month = Number(m);
  const day = Number(d);
  if (!month || !day) {
    return date;
  }
  return t("admin.stats.dayMonth", {
    day: localizeDigits(String(day), locale),
    month: t(`months.short.${month}`),
  });
}

/** A localized, direction-isolated number for use inside sentences. */
export function useNumber() {
  const { i18n } = useTranslation();
  return (value: number) =>
    isolateNumeric(localizeDigits(value.toLocaleString("en-US"), i18n.language));
}

export interface ChartSeries {
  key: string;
  label: string;
  values: readonly number[];
  color: string;
  kind: "bars" | "line";
}

/**
 * A small time chart: bars and/or lines over the same days, with the first,
 * middle and last date under it. Like the Event hub's timeline slide, the
 * time axis runs left to right in every language (as on a map). The picture
 * is decoration for screen readers: `a11yLabel` says what it shows in words.
 */
export function TimeChart({
  dates,
  series,
  a11yLabel,
  height = 96,
  testID,
}: {
  dates: readonly string[];
  series: readonly ChartSeries[];
  a11yLabel: string;
  height?: number;
  testID?: string;
}) {
  const { t, i18n } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const [width, setWidth] = useState(300);
  const n = Math.max(1, dates.length);
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const slot = width / n;
  const y = (v: number) => height - (v / max) * (height - 4);
  const bars = series.filter((s) => s.kind === "bars");
  const lines = series.filter((s) => s.kind === "line");
  const barWidth = Math.max(1, slot / Math.max(1, bars.length) - 1);
  const ticks =
    dates.length > 2
      ? [0, Math.floor((dates.length - 1) / 2), dates.length - 1]
      : dates.map((_, i) => i);
  const caption = {
    color: colors.text.secondary,
    fontSize: typography.labelCaption.fontSize,
    fontFamily: nativeFontFamily(typography.labelCaption, "400"),
  };

  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="image"
      accessibilityLabel={a11yLabel}
      onLayout={(e: LayoutChangeEvent) => {
        const w = Math.round(e.nativeEvent.layout.width);
        if (w > 0 && w !== width) setWidth(w);
      }}
      style={[styles.ltr, { gap: spacing[1] }]}
    >
      <Svg width={width} height={height}>
        <Line
          x1={0}
          y1={height - 0.5}
          x2={width}
          y2={height - 0.5}
          stroke={colors.border.default}
          strokeWidth={1}
        />
        {bars.map((s, si) =>
          s.values.map((v, i) =>
            v > 0 ? (
              <Rect
                key={`${s.key}-${i}`}
                x={i * slot + si * barWidth + 0.5}
                y={y(v)}
                width={barWidth}
                height={height - y(v)}
                fill={s.color}
              />
            ) : null,
          ),
        )}
        {lines.map((s) => (
          <Polyline
            key={s.key}
            points={s.values.map((v, i) => `${(i + 0.5) * slot},${y(v)}`).join(" ")}
            fill="none"
            stroke={s.color}
            strokeWidth={2}
          />
        ))}
      </Svg>
      <View style={styles.axis}>
        {ticks.map((i) => (
          <Text key={i} style={caption}>
            {dates[i] ? dayMonth(dates[i] as string, i18n.language, t) : ""}
          </Text>
        ))}
      </View>
      {series.length > 1 ? <Legend series={series} /> : null}
    </View>
  );
}

function Legend({ series }: { series: readonly ChartSeries[] }) {
  const { colors, typography, spacing } = useTheme();
  const dir = useTextDir();
  return (
    <View style={[styles.legend, { gap: spacing[3] }]}>
      {series.map((s) => (
        <View key={s.key} style={[styles.legendItem, { gap: spacing[1] }]}>
          <View
            style={
              s.kind === "bars"
                ? [styles.legendBar, { backgroundColor: s.color }]
                : [styles.legendLine, { backgroundColor: s.color }]
            }
          />
          <Text
            style={[
              dir,
              {
                color: colors.text.secondary,
                fontSize: typography.labelCaption.fontSize,
                fontFamily: nativeFontFamily(typography.labelCaption, "400"),
              },
            ]}
          >
            {s.label}
          </Text>
        </View>
      ))}
    </View>
  );
}

/**
 * Tagged homes per vulnerability class: one row per class with the app's VC
 * colour chip, ALWAYS the letter and the class name next to it (colour only
 * reinforces), a bar and the count. A null count means "fewer than 5" (the
 * Officials page) and draws no bar.
 */
export function VcRows({
  counts,
  testID,
}: {
  counts: Record<VulnerabilityClass, number | null>;
  testID?: string;
}) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const dir = useTextDir();
  const num = useNumber();
  const classes = Object.keys(counts) as VulnerabilityClass[];
  const max = Math.max(1, ...classes.map((vc) => counts[vc] ?? 0));
  return (
    <View testID={testID} style={{ gap: spacing[2] }}>
      {classes.map((vc) => {
        const value = counts[vc];
        const name = t(`building.vc.name.${vc}`);
        const valueText = value === null ? t("officials.fewerThan5") : num(value);
        return (
          <View
            key={vc}
            accessible
            accessibilityLabel={t("admin.stats.classA11y", {
              vc,
              name,
              count: valueText,
            })}
            style={[styles.vcRow, { gap: spacing[2] }]}
            testID={testID ? `${testID}-${vc}` : undefined}
          >
            <View style={[styles.vcChip, { backgroundColor: VC_COLORS[vc].fill }]}>
              <Text
                style={[
                  typography.labelCaption,
                  styles.vcLetter,
                  { color: VC_COLORS[vc].text },
                ]}
              >
                {vc}
              </Text>
            </View>
            <Text
              style={[
                typography.labelCaption,
                dir,
                styles.vcName,
                { color: colors.text.primary },
              ]}
              numberOfLines={2}
            >
              {name}
            </Text>
            <View style={[styles.track, { backgroundColor: colors.surface.sunken }]}>
              {value !== null && value > 0 ? (
                <View
                  style={{
                    width: `${Math.max(3, Math.round((value / max) * 100))}%`,
                    backgroundColor: VC_COLORS[vc].fill,
                    borderRadius: 3,
                  }}
                />
              ) : null}
            </View>
            <Text
              style={[
                typography.labelCaption,
                styles.vcCount,
                { color: value === null ? colors.text.tertiary : colors.text.primary },
              ]}
            >
              {valueText}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  ltr: { direction: "ltr" },
  axis: { flexDirection: "row", justifyContent: "space-between" },
  legend: { flexDirection: "row", flexWrap: "wrap", alignItems: "center" },
  legendItem: { flexDirection: "row", alignItems: "center" },
  legendBar: { width: 10, height: 10, borderRadius: 2 },
  legendLine: { width: 14, height: 2 },
  vcRow: { flexDirection: "row", alignItems: "center", minHeight: 28 },
  vcChip: {
    width: 24,
    height: 24,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  vcLetter: { fontWeight: "800" },
  vcName: { width: "32%" },
  track: {
    flex: 1,
    height: 10,
    borderRadius: 5,
    overflow: "hidden",
    flexDirection: "row",
  },
  vcCount: { minWidth: 36, textAlign: "center" },
});
