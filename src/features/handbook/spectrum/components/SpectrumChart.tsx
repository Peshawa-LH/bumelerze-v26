import { Fragment, useState } from "react";
import type { LayoutChangeEvent } from "react-native";
import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import Svg, { Circle, Line, Polyline, Text as SvgText } from "react-native-svg";

import { useTheme } from "@/theme";
import { formatCoefficient, formatPeriodSeconds } from "../format";
import type { SpectrumCurve, SpectrumParameters } from "../types";

interface SpectrumChartProps {
  curve: SpectrumCurve;
  params: SpectrumParameters;
  tMax: number;
  locale: string;
  accessibilityLabel: string;
}

const CHART_HEIGHT = 240;
const CHART_PADDING_LEFT = 44;
const CHART_PADDING_BOTTOM = 28;
const CHART_PADDING_TOP = 12;
const CHART_PADDING_RIGHT = 8;
const Y_TICK_COUNT = 4;
const X_TICK_COUNT = 4;

function niceMax(value: number): number {
  if (value <= 0) return 1;
  // Round the Y-domain top up to a "nice" step (0.1 g increments) so the
  // axis never shows an ugly value like "0.4137 g" — this is a display
  // concern only, never affects the plotted data.
  return Math.ceil(value / 0.1) * 0.1;
}

/**
 * The ISC-2017 code (unreduced) spectrum and the R/I-reduced curve on one
 * axis (§7.2), plus the two T-independent Cs reference lines (§7.2's
 * "horizontal guide lines" instruction — see `compute.ts`'s doc comment
 * for why only the T-independent pieces of the Cs formula are drawn: the
 * T-dependent cap of eq. 3-9/3 is exactly the reduced curve's own
 * `Ts < T <= TL` branch already on screen, not a separate line).
 *
 * RTL: the plot area is wrapped in `direction: "ltr"` — the established
 * non-mirroring pattern this codebase already uses three times
 * (`SeismogramChart`, `ShakeMapView`, `FeltMapView`; written policy in
 * design-language.md §5 "What does NOT mirror"). Period must always
 * increase left-to-right: a spectrum read right-to-left is scientifically
 * wrong, not a stylistic RTL choice. The Y axis stays on the left in every
 * locale for the same reason (§8.2: moving it right while data still runs
 * left-to-right would read as mirrored without being mirrored).
 */
export function SpectrumChart({ curve, params, tMax, locale, accessibilityLabel }: SpectrumChartProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [width, setWidth] = useState(0);

  function handleLayout(event: LayoutChangeEvent) {
    setWidth(event.nativeEvent.layout.width);
  }

  const plotWidth = Math.max(width - CHART_PADDING_LEFT - CHART_PADDING_RIGHT, 0);
  const plotHeight = CHART_HEIGHT - CHART_PADDING_TOP - CHART_PADDING_BOTTOM;

  const dataMax = Math.max(
    ...curve.code.map((p) => p.sa),
    ...curve.reduced.map((p) => p.sa),
    params.csUnreduced,
    0.1,
  );
  const yMax = niceMax(dataMax);

  function toX(tValue: number): number {
    return CHART_PADDING_LEFT + (tValue / tMax) * plotWidth;
  }
  function toY(sa: number): number {
    return CHART_PADDING_TOP + plotHeight - (sa / yMax) * plotHeight;
  }

  function toPoints(points: SpectrumCurve["code"]): string {
    return points.map((p) => `${toX(p.t)},${toY(p.sa)}`).join(" ");
  }

  const xTicks = Array.from({ length: X_TICK_COUNT + 1 }, (_, i) => (tMax / X_TICK_COUNT) * i);
  const yTicks = Array.from({ length: Y_TICK_COUNT + 1 }, (_, i) => (yMax / Y_TICK_COUNT) * i);

  const cornerPoints = curve.code.filter((p) => p.isCornerPoint && p.t <= tMax);

  return (
    <View style={{ gap: 8 }}>
      <View
        testID="spectrum-chart-container"
        onLayout={handleLayout}
        accessible
        accessibilityRole="image"
        accessibilityLabel={accessibilityLabel}
        style={[
          styles.container,
          { backgroundColor: colors.surface.sunken, borderColor: colors.border.subtle },
          { direction: "ltr" },
        ]}
      >
        {width > 0 ? (
          <Svg width={width} height={CHART_HEIGHT}>
            {/* Axis lines */}
            <Line
              x1={CHART_PADDING_LEFT}
              y1={CHART_PADDING_TOP}
              x2={CHART_PADDING_LEFT}
              y2={CHART_PADDING_TOP + plotHeight}
              stroke={colors.border.default}
              strokeWidth={1}
            />
            <Line
              x1={CHART_PADDING_LEFT}
              y1={CHART_PADDING_TOP + plotHeight}
              x2={CHART_PADDING_LEFT + plotWidth}
              y2={CHART_PADDING_TOP + plotHeight}
              stroke={colors.border.default}
              strokeWidth={1}
            />

            {/* Y gridlines + tick labels */}
            {yTicks.map((tick) => (
              <Fragment key={`y-${tick}`}>
                <Line
                  x1={CHART_PADDING_LEFT}
                  y1={toY(tick)}
                  x2={CHART_PADDING_LEFT + plotWidth}
                  y2={toY(tick)}
                  stroke={colors.border.subtle}
                  strokeWidth={1}
                  // "0" (not `undefined`) for the zero gridline — a
                  // zero-length dash renders as a solid line in SVG, and
                  // `exactOptionalPropertyTypes` rejects an explicit
                  // `undefined` for this prop.
                  strokeDasharray={tick === 0 ? "0" : "2,3"}
                />
                <SvgText
                  x={CHART_PADDING_LEFT - 6}
                  y={toY(tick) + 4}
                  fontSize={10}
                  fill={colors.text.tertiary}
                  textAnchor="end"
                >
                  {formatCoefficient(tick, locale)}
                </SvgText>
              </Fragment>
            ))}

            {/* X tick labels */}
            {xTicks.map((tick) => (
              <SvgText
                key={`x-${tick}`}
                x={toX(tick)}
                y={CHART_PADDING_TOP + plotHeight + 16}
                fontSize={10}
                fill={colors.text.tertiary}
                textAnchor="middle"
              >
                {formatPeriodSeconds(tick, locale)}
              </SvgText>
            ))}

            {/* Cs floor + Cs (unreduced plateau) reference lines — both
             * genuinely T-independent constants, see the module doc
             * comment above. */}
            {params.csFloor <= yMax ? (
              <Line
                testID="spectrum-cs-floor-line"
                x1={CHART_PADDING_LEFT}
                y1={toY(params.csFloor)}
                x2={CHART_PADDING_LEFT + plotWidth}
                y2={toY(params.csFloor)}
                stroke={colors.status.warning}
                strokeWidth={1}
                strokeDasharray="1,3"
              />
            ) : null}
            {params.csUnreduced <= yMax ? (
              <Line
                testID="spectrum-cs-plateau-line"
                x1={CHART_PADDING_LEFT}
                y1={toY(params.csUnreduced)}
                x2={CHART_PADDING_LEFT + plotWidth}
                y2={toY(params.csUnreduced)}
                stroke={colors.status.info}
                strokeWidth={1}
                strokeDasharray="1,3"
              />
            ) : null}

            {/* Code (unreduced) curve — solid */}
            <Polyline
              testID="spectrum-code-curve"
              points={toPoints(curve.code)}
              fill="none"
              stroke={colors.brand.primary}
              strokeWidth={2.5}
              strokeLinejoin="round"
              strokeLinecap="round"
            />

            {/* Reduced curve — dashed */}
            <Polyline
              testID="spectrum-reduced-curve"
              points={toPoints(curve.reduced)}
              fill="none"
              stroke={colors.status.success}
              strokeWidth={2.5}
              strokeDasharray="6,4"
              strokeLinejoin="round"
              strokeLinecap="round"
            />

            {/* Corner-point markers (T0, Ts, TL when visible) */}
            {cornerPoints.map((p) => (
              <Circle
                key={`corner-${p.t}`}
                testID="spectrum-corner-marker"
                cx={toX(p.t)}
                cy={toY(p.sa)}
                r={3}
                fill={colors.brand.primary}
              />
            ))}
          </Svg>
        ) : null}
      </View>

      {/* Legend — same non-mirroring rule as the plot: a swatch-then-label
       * sequence always reads in a fixed order regardless of locale. */}
      <View style={[styles.legendRow, { direction: "ltr" }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <View style={styles.legendItem}>
          <View style={[styles.swatch, { backgroundColor: colors.brand.primary }]} />
          <Text style={{ color: colors.text.secondary, fontSize: 11 }}>{t("handbook.spectrum.legend.code")}</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.swatch, { backgroundColor: colors.status.success }]} />
          <Text style={{ color: colors.text.secondary, fontSize: 11 }}>
            {t("handbook.spectrum.legend.reduced")}
          </Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.swatch, { backgroundColor: colors.status.info }]} />
          <Text style={{ color: colors.text.secondary, fontSize: 11 }}>
            {t("handbook.spectrum.legend.csPlateau")}
          </Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.swatch, { backgroundColor: colors.status.warning }]} />
          <Text style={{ color: colors.text.secondary, fontSize: 11 }}>{t("handbook.spectrum.legend.csFloor")}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: "100%",
    height: CHART_HEIGHT,
    borderRadius: 12,
    borderWidth: 1,
    overflow: "hidden",
  },
  legendRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  swatch: {
    width: 14,
    height: 3,
    borderRadius: 2,
  },
});
