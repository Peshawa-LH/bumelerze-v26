import { useState } from "react";
import type { LayoutChangeEvent } from "react-native";
import { StyleSheet, View } from "react-native";
import Svg, { Line, Polyline } from "react-native-svg";

import { useTheme } from "@/theme";
import { axisColor } from "../colors";
import { MIN_Y_HALF_SPAN_G, PLOT_WINDOW_MS } from "../constants";
import type { AxisKey, AxisVisibility, SensorSample } from "../types";

interface SeismogramChartProps {
  samples: SensorSample[];
  activeAxes: AxisVisibility;
  accessibilityLabel: string;
}

const CHART_HEIGHT = 220;
const AXES: readonly AxisKey[] = ["x", "y", "z"];
/** Symmetric headroom above the raw data range so a trace never touches the
 * very top/bottom edge of the chart. */
const Y_PADDING_FACTOR = 1.1;

function computeYDomain(samples: readonly SensorSample[]): [number, number] {
  if (samples.length === 0) {
    return [-MIN_Y_HALF_SPAN_G, MIN_Y_HALF_SPAN_G];
  }

  let dataMin = Infinity;
  let dataMax = -Infinity;
  for (const sample of samples) {
    dataMin = Math.min(dataMin, sample.x, sample.y, sample.z);
    dataMax = Math.max(dataMax, sample.x, sample.y, sample.z);
  }

  const mid = (dataMin + dataMax) / 2;
  const half = Math.max(((dataMax - dataMin) / 2) * Y_PADDING_FACTOR, MIN_Y_HALF_SPAN_G);
  return [mid - half, mid + half];
}

/**
 * Live 3-axis accelerometer trace (spec-v1.md §4.8). Renders via plain
 * `react-native-svg` polylines — no chart library, no Skia, the boring
 * choice per PROJECT.md's "prefer boring, well-documented" gotcha. Receives
 * already-windowed, already-throttled samples from `useAccelerometerStream`;
 * this component itself does no timers or sensor work, only layout + math.
 */
export function SeismogramChart({
  samples,
  activeAxes,
  accessibilityLabel,
}: SeismogramChartProps) {
  const { colors } = useTheme();
  const [width, setWidth] = useState(0);

  function handleLayout(event: LayoutChangeEvent) {
    setWidth(event.nativeEvent.layout.width);
  }

  const lastSample = samples.length > 0 ? samples[samples.length - 1] : undefined;
  // Falls back to "now" only when the buffer is still empty (first frame
  // after focus, before the first render tick has landed) — never read as
  // part of a later re-render once real samples exist.
  // eslint-disable-next-line react-hooks/purity -- see comment above
  const latestT = lastSample ? lastSample.t : Date.now();
  const xMin = latestT - PLOT_WINDOW_MS;
  const xSpan = Math.max(PLOT_WINDOW_MS, 1);

  const [yMin, yMax] = computeYDomain(samples);
  const ySpan = Math.max(yMax - yMin, 1e-6);

  function toPoints(axis: AxisKey): string {
    return samples
      .map((sample) => {
        const px = ((sample.t - xMin) / xSpan) * width;
        const py = CHART_HEIGHT - ((sample[axis] - yMin) / ySpan) * CHART_HEIGHT;
        return `${px},${py}`;
      })
      .join(" ");
  }

  const showZeroLine = 0 >= yMin && 0 <= yMax;
  const zeroLineY = CHART_HEIGHT - ((0 - yMin) / ySpan) * CHART_HEIGHT;

  return (
    <View
      onLayout={handleLayout}
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
      style={[
        styles.container,
        {
          backgroundColor: colors.surface.sunken,
          borderColor: colors.border.subtle,
        },
        // The seismogram never mirrors under RTL (design-language.md §5
        // "What does NOT mirror" — time always flows left→right on the
        // X-axis in every locale; mirroring a waveform would misrepresent
        // the data). Fixing `direction: 'ltr'` here overrides the RTL
        // layout direction the surrounding Sorani/Arabic screen otherwise
        // applies, so this container's own coordinate space stays LTR
        // regardless of locale.
        { direction: "ltr" },
      ]}
    >
      {width > 0 ? (
        <Svg width={width} height={CHART_HEIGHT}>
          {showZeroLine ? (
            <Line
              x1={0}
              y1={zeroLineY}
              x2={width}
              y2={zeroLineY}
              stroke={colors.border.default}
              strokeWidth={1}
              strokeDasharray="4,4"
            />
          ) : null}
          {AXES.filter((axis) => activeAxes[axis]).map((axis) => (
            <Polyline
              key={axis}
              points={toPoints(axis)}
              fill="none"
              stroke={axisColor(colors, axis)}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
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
    height: CHART_HEIGHT,
    borderRadius: 12,
    borderWidth: 1,
    overflow: "hidden",
  },
});
