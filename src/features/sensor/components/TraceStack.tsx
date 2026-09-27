import { useState } from "react";
import type { LayoutChangeEvent } from "react-native";
import { StyleSheet, View } from "react-native";
import Svg, { Line, Polyline } from "react-native-svg";

import { useTheme } from "@/theme";
import { axisColor } from "../colors";
import { PLOT_WINDOW_MS, TRACE_HALF_SPAN_G } from "../constants";
import { clamp } from "../projection";
import type { AxisKey, SensorSample } from "../types";

interface TraceStackProps {
  samples: SensorSample[];
  /** Wall-clock time of the frame; the right edge of every strip. */
  frameAt: number;
  accessibilityLabel: string;
}

const AXES: readonly AxisKey[] = ["x", "y", "z"];
/** Height of one channel's strip; three strips plus two dividers. */
const STRIP_HEIGHT = 96;
const HEIGHT = STRIP_HEIGHT * AXES.length;

/**
 * Figure 1 (owner, 2026-09-27): three strips stacked, one channel each,
 * every one centred on zero at the SAME fixed ±`TRACE_HALF_SPAN_G` scale.
 * Nothing about the axes is derived from the data — the earlier single
 * chart auto-scaled its Y range to the last ten seconds every frame,
 * which is what made the whole picture breathe and jump. Amplitudes past
 * the span are clipped to the strip edge rather than rescaling it.
 * Plain `react-native-svg` polylines; time always flows left→right (the
 * container pins `direction: "ltr"` under RTL locales).
 */
export function TraceStack({ samples, frameAt, accessibilityLabel }: TraceStackProps) {
  const { colors } = useTheme();
  const [width, setWidth] = useState(0);

  function handleLayout(event: LayoutChangeEvent) {
    setWidth(event.nativeEvent.layout.width);
  }

  const xMin = frameAt - PLOT_WINDOW_MS;

  function toPoints(axis: AxisKey, top: number): string {
    const mid = top + STRIP_HEIGHT / 2;
    const pxPerG = STRIP_HEIGHT / 2 / TRACE_HALF_SPAN_G;
    return samples
      .map((sample) => {
        const px = ((sample.t - xMin) / PLOT_WINDOW_MS) * width;
        const py = mid - clamp(sample[axis], TRACE_HALF_SPAN_G) * pxPerG;
        return `${px.toFixed(1)},${py.toFixed(1)}`;
      })
      .join(" ");
  }

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
          {AXES.map((axis, index) => {
            const top = index * STRIP_HEIGHT;
            const mid = top + STRIP_HEIGHT / 2;
            return (
              <Polyline
                key={`${axis}-zero`}
                points={`0,${mid} ${width},${mid}`}
                fill="none"
                stroke={colors.border.default}
                strokeWidth={1}
                strokeDasharray="4,4"
              />
            );
          })}
          {AXES.slice(1).map((axis, index) => {
            const y = (index + 1) * STRIP_HEIGHT;
            return (
              <Line
                key={`${axis}-divider`}
                x1={0}
                y1={y}
                x2={width}
                y2={y}
                stroke={colors.border.subtle}
                strokeWidth={1}
              />
            );
          })}
          {AXES.map((axis, index) => (
            <Polyline
              key={axis}
              points={toPoints(axis, index * STRIP_HEIGHT)}
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
    height: HEIGHT,
    borderRadius: 12,
    borderWidth: 1,
    overflow: "hidden",
  },
});
