import { useState } from "react";
import type { LayoutChangeEvent } from "react-native";
import { StyleSheet, View } from "react-native";
import Svg, { Circle, G, Line, Text as SvgText } from "react-native-svg";

import { useTheme } from "@/theme";
import { axisColor } from "../colors";
import { SPACE_HALF_SPAN_G, SPACE_TRAIL_MS } from "../constants";
import {
  clamp,
  PHONE_EDGES,
  phoneCorners,
  projectPoint,
  type PhonePose,
} from "../projection";
import type { AccelerometerVector, AxisKey, SensorSample } from "../types";

interface SpaceViewProps {
  samples: SensorSample[];
  /** Wall-clock time of the frame; trail age is measured from it. */
  frameAt: number;
  accessibilityLabel: string;
  /** Standing (default) or lying flat — the legend's flip button. */
  pose?: PhonePose;
}

const HEIGHT = 288;
const AXES: readonly AxisKey[] = ["x", "y", "z"];
/** Axis arms and label positions, in view units (1 = the half span). */
const AXIS_ARM = 1.05;
const AXIS_LABEL = 1.2;
const DOT_RADIUS = 7;

function toUnits(sample: AccelerometerVector): AccelerometerVector {
  return {
    x: clamp(sample.x, SPACE_HALF_SPAN_G) / SPACE_HALF_SPAN_G,
    y: clamp(sample.y, SPACE_HALF_SPAN_G) / SPACE_HALF_SPAN_G,
    z: clamp(sample.z, SPACE_HALF_SPAN_G) / SPACE_HALF_SPAN_G,
  };
}

/**
 * Figure 2 (owner, 2026-09-27): the phone as a slab in its own fixed X/Y/Z
 * frame, a dot for the current (gravity-removed) acceleration and a trail
 * of the last `SPACE_TRAIL_MS` that fades with age. Same fixed
 * ±`SPACE_HALF_SPAN_G` span as the traces, same three channel colours on
 * the axes. Orthographic projection from `projection.ts`; the camera never
 * moves.
 */
export function SpaceView({
  samples,
  frameAt,
  accessibilityLabel,
  pose = "standing",
}: SpaceViewProps) {
  const { colors, typography } = useTheme();
  const [width, setWidth] = useState(0);

  function handleLayout(event: LayoutChangeEvent) {
    setWidth(event.nativeEvent.layout.width);
  }

  const cx = width / 2;
  const cy = HEIGHT / 2;
  // Leave room for the axis labels past the arms.
  const scale = Math.min(width, HEIGHT) / 2 / (AXIS_LABEL + 0.15);

  const latest = samples.length > 0 ? samples[samples.length - 1] : undefined;
  const trail = samples.filter((sample) => frameAt - sample.t <= SPACE_TRAIL_MS);
  const trailPoints = trail.map((sample) => ({
    ...projectPoint(toUnits(sample), scale, cx, cy, pose),
    age: Math.min(1, Math.max(0, (frameAt - sample.t) / SPACE_TRAIL_MS)),
  }));
  const dot = latest ? projectPoint(toUnits(latest), scale, cx, cy, pose) : null;
  const corners = phoneCorners().map((corner) =>
    projectPoint(corner, scale, cx, cy, pose),
  );
  const origin = projectPoint({ x: 0, y: 0, z: 0 }, scale, cx, cy, pose);

  function unitVector(axis: AxisKey, length: number): AccelerometerVector {
    return {
      x: axis === "x" ? length : 0,
      y: axis === "y" ? length : 0,
      z: axis === "z" ? length : 0,
    };
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
          {AXES.map((axis) => {
            const end = projectPoint(unitVector(axis, AXIS_ARM), scale, cx, cy, pose);
            const back = projectPoint(unitVector(axis, -AXIS_ARM), scale, cx, cy, pose);
            const label = projectPoint(unitVector(axis, AXIS_LABEL), scale, cx, cy, pose);
            const color = axisColor(colors, axis);
            return (
              <G key={axis}>
                <Line
                  x1={back.u}
                  y1={back.v}
                  x2={origin.u}
                  y2={origin.v}
                  stroke={color}
                  strokeWidth={1}
                  strokeOpacity={0.35}
                  strokeDasharray="3,4"
                />
                <Line
                  x1={origin.u}
                  y1={origin.v}
                  x2={end.u}
                  y2={end.v}
                  stroke={color}
                  strokeWidth={1.5}
                  strokeOpacity={0.8}
                />
                <SvgText
                  x={label.u}
                  y={label.v}
                  fill={color}
                  fontSize={typography.labelButton.fontSize}
                  fontWeight="700"
                  textAnchor="middle"
                  alignmentBaseline="middle"
                >
                  {axis.toUpperCase()}
                </SvgText>
              </G>
            );
          })}
          {PHONE_EDGES.map(([a, b]) => {
            const from = corners[a];
            const to = corners[b];
            if (!from || !to) return null;
            return (
              <Line
                key={`${a}-${b}`}
                x1={from.u}
                y1={from.v}
                x2={to.u}
                y2={to.v}
                stroke={colors.text.secondary}
                strokeWidth={1.25}
                strokeOpacity={0.7}
              />
            );
          })}
          {trailPoints.slice(1).map((point, index) => {
            const previous = trailPoints[index];
            if (!previous) return null;
            return (
              <Line
                key={index}
                x1={previous.u}
                y1={previous.v}
                x2={point.u}
                y2={point.v}
                stroke={colors.brand.primary}
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeOpacity={Math.max(0.08, 1 - point.age)}
              />
            );
          })}
          {dot ? (
            <G>
              <Circle
                cx={dot.u}
                cy={dot.v}
                r={DOT_RADIUS * 1.9}
                fill={colors.brand.primary}
                fillOpacity={0.18}
              />
              <Circle cx={dot.u} cy={dot.v} r={DOT_RADIUS} fill={colors.brand.primary} />
            </G>
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
