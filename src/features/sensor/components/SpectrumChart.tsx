import { useState } from "react";
import type { LayoutChangeEvent } from "react-native";
import { StyleSheet, View } from "react-native";
import Svg, { Line, Polyline, Text as SvgText } from "react-native-svg";

import { useTheme } from "@/theme";
import { axisColor } from "../colors";
import type { ResponseSpectrum } from "../response-spectrum";
import type { AxisKey } from "../types";

interface SpectrumChartProps {
  spectrum: ResponseSpectrum | null;
  periodAxisLabel: string;
  saAxisLabel: string;
  accessibilityLabel: string;
}

const HEIGHT = 240;
const PAD = { top: 12, right: 12, bottom: 28, left: 40 };
const AXES: readonly AxisKey[] = ["x", "y", "z"];
const PERIOD_TICKS = [0.1, 0.5, 1, 2, 4];
/** Below this the plot is flat noise; the scale never shrinks past it. */
const MIN_SA_G = 0.02;

/**
 * Figure 3: the response spectrum of the last ten seconds, per axis —
 * log period across, pseudo-acceleration in g up, auto-scaled to the
 * strongest axis (a fixed scale would hide gentle shaking entirely).
 */
export function SpectrumChart({
  spectrum,
  periodAxisLabel,
  saAxisLabel,
  accessibilityLabel,
}: SpectrumChartProps) {
  const { colors, typography } = useTheme();
  const [width, setWidth] = useState(0);

  function handleLayout(event: LayoutChangeEvent) {
    setWidth(event.nativeEvent.layout.width);
  }

  const plotW = Math.max(0, width - PAD.left - PAD.right);
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const tMin = Math.log10(0.05);
  const tMax = Math.log10(4);
  const xOf = (period: number) =>
    PAD.left + ((Math.log10(period) - tMin) / (tMax - tMin)) * plotW;
  let saMax = MIN_SA_G;
  if (spectrum) {
    for (const axis of AXES) for (const v of spectrum.sa[axis]) if (v > saMax) saMax = v;
  }
  saMax *= 1.1;
  const yOf = (sa: number) => PAD.top + plotH - (sa / saMax) * plotH;

  function toPoints(axis: AxisKey): string {
    if (!spectrum) return "";
    return spectrum.periodsS
      .map(
        (period, i) =>
          `${xOf(period).toFixed(1)},${yOf(spectrum.sa[axis][i] ?? 0).toFixed(1)}`,
      )
      .join(" ");
  }

  const tick = { fill: colors.text.tertiary, fontSize: typography.labelCaption.fontSize };

  return (
    <View
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
        <Svg width={width} height={HEIGHT}>
          <Line
            x1={PAD.left}
            y1={PAD.top}
            x2={PAD.left}
            y2={PAD.top + plotH}
            stroke={colors.border.default}
            strokeWidth={1}
          />
          <Line
            x1={PAD.left}
            y1={PAD.top + plotH}
            x2={PAD.left + plotW}
            y2={PAD.top + plotH}
            stroke={colors.border.default}
            strokeWidth={1}
          />
          {PERIOD_TICKS.map((period) => (
            <SvgText
              key={period}
              x={xOf(period)}
              y={HEIGHT - 12}
              textAnchor="middle"
              {...tick}
            >
              {String(period)}
            </SvgText>
          ))}
          <SvgText x={PAD.left + plotW / 2} y={HEIGHT - 1} textAnchor="middle" {...tick}>
            {periodAxisLabel}
          </SvgText>
          <SvgText x={PAD.left - 4} y={PAD.top + 4} textAnchor="end" {...tick}>
            {saMax.toFixed(2)}
          </SvgText>
          <SvgText x={PAD.left - 4} y={PAD.top + plotH} textAnchor="end" {...tick}>
            0
          </SvgText>
          <SvgText x={4} y={PAD.top + plotH / 2} {...tick}>
            {saAxisLabel}
          </SvgText>
          {AXES.map((axis) => (
            <Polyline
              key={axis}
              points={toPoints(axis)}
              fill="none"
              stroke={axisColor(colors, axis)}
              strokeWidth={2}
              strokeLinejoin="round"
            />
          ))}
        </Svg>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: "100%",
    height: HEIGHT,
    borderRadius: 12,
    borderWidth: 1,
    overflow: "hidden",
  },
});
