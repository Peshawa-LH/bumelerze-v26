import { useState } from "react";
import type { LayoutChangeEvent } from "react-native";
import { StyleSheet, View } from "react-native";
import Svg, { Line, Polyline } from "react-native-svg";

import { useTheme } from "@/theme";
import { TRACE_WINDOW_MS } from "../trace-transport";
import type { StationTrace } from "../types";

interface StationTraceChartProps {
  trace: StationTrace | null;
  accessibilityLabel: string;
}

const HEIGHT = 160;
/** Points drawn at most; each is the min and max of its time bin, so a
 * spike at 100 sps survives the reduction. */
const MAX_BINS = 400;

/** Mean removed, reduced to min/max per bin, as SVG points. Exported for tests. */
export function traceToPoints(
  trace: StationTrace,
  width: number,
  height: number,
): string {
  const n = trace.samples.length;
  if (n === 0 || width <= 0) return "";
  let mean = 0;
  for (const v of trace.samples) mean += v;
  mean /= n;
  let peak = 1;
  for (const v of trace.samples) peak = Math.max(peak, Math.abs(v - mean));
  const pxPerUnit = ((height / 2) * 0.9) / peak;
  const windowStart = trace.endMs - TRACE_WINDOW_MS;
  const stepMs = 1000 / trace.sps;
  const bins = Math.min(MAX_BINS, n);
  const per = n / bins;
  const out: string[] = [];
  for (let b = 0; b < bins; b += 1) {
    const from = Math.floor(b * per);
    const to = Math.min(n, Math.floor((b + 1) * per)) || from + 1;
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = from; i < to; i += 1) {
      const v = trace.samples[i] ?? 0;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    const tMs = trace.startMs + from * stepMs;
    const x = ((tMs - windowStart) / TRACE_WINDOW_MS) * width;
    const yLo = height / 2 - (lo - mean) * pxPerUnit;
    const yHi = height / 2 - (hi - mean) * pxPerUnit;
    out.push(`${x.toFixed(1)},${yHi.toFixed(1)} ${x.toFixed(1)},${yLo.toFixed(1)}`);
  }
  return out.join(" ");
}

/**
 * The last ten minutes of one station, mean removed, auto-scaled to its
 * own peak (a station's counts mean nothing across stations, so no fixed
 * scale here — unlike the phone seismogram). Time flows left→right in
 * every locale.
 */
export function StationTraceChart({ trace, accessibilityLabel }: StationTraceChartProps) {
  const { colors } = useTheme();
  const [width, setWidth] = useState(0);

  function handleLayout(event: LayoutChangeEvent) {
    setWidth(event.nativeEvent.layout.width);
  }

  const points = trace && width > 0 ? traceToPoints(trace, width, HEIGHT) : "";

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
            x1={0}
            y1={HEIGHT / 2}
            x2={width}
            y2={HEIGHT / 2}
            stroke={colors.border.default}
            strokeWidth={1}
            strokeDasharray="4,4"
          />
          {points ? (
            <Polyline
              points={points}
              fill="none"
              stroke={colors.status.info}
              strokeWidth={1.5}
              strokeLinejoin="round"
            />
          ) : null}
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
