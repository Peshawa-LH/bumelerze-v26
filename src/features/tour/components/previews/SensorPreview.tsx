import { useMemo, useState } from "react";
import { Text, View, type LayoutChangeEvent } from "react-native";
import { useTranslation } from "react-i18next";
import Svg, { Polyline } from "react-native-svg";

import { axisColor, AXIS_CHIP_ON_FILL_TEXT } from "@/features/sensor/colors";
import type { AxisKey } from "@/features/sensor/types";
import { useTheme } from "@/theme";

const AXES: readonly AxisKey[] = ["x", "y", "z"];
const VIEW_WIDTH = 240;
const VIEW_HEIGHT = 108;
const SAMPLES = 80;
const FALLBACK_WIDTH = 260;

/** Per-axis look of the drawn trace: baseline, size, wiggle speed, phase. */
const TRACE_SHAPE: Record<
  AxisKey,
  { y: number; amp: number; freq: number; phase: number }
> = {
  x: { y: 20, amp: 15, freq: 0.9, phase: 0 },
  y: { y: 54, amp: 12, freq: 1.1, phase: 1.7 },
  z: { y: 88, amp: 17, freq: 0.8, phase: 3.1 },
};

/** A quiet signal with one burst of shaking in the middle, drawn the same way
 * for every axis. Pure maths, so the picture is identical on every run. */
function tracePoints(axis: AxisKey): string {
  const { y, amp, freq, phase } = TRACE_SHAPE[axis];
  const points: string[] = [];
  for (let i = 0; i < SAMPLES; i += 1) {
    const x = (i / (SAMPLES - 1)) * VIEW_WIDTH;
    const burst = Math.exp(-(((i - 44) / 11) ** 2));
    const value = (0.12 + burst) * amp * Math.sin(i * freq + phase);
    points.push(`${x.toFixed(1)},${(y + value).toFixed(1)}`);
  }
  return points.join(" ");
}

/** Sensor: the two-mode switch, a still three-axis trace and the axis keys. */
export function SensorPreview() {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const [width, setWidth] = useState(FALLBACK_WIDTH);
  const traces = useMemo(
    () => AXES.map((axis) => ({ axis, points: tracePoints(axis) })),
    [],
  );

  function onLayout(event: LayoutChangeEvent) {
    const measured = Math.floor(event.nativeEvent.layout.width);
    if (measured > 0) setWidth(measured);
  }

  return (
    <View style={{ gap: spacing[3] }}>
      <View
        style={{
          flexDirection: "row",
          borderWidth: 1,
          borderRadius: 12,
          padding: 3,
          backgroundColor: colors.surface.sunken,
          borderColor: colors.border.subtle,
        }}
      >
        {(["phone", "stations"] as const).map((option) => {
          const selected = option === "phone";
          return (
            <View
              key={option}
              style={{
                flex: 1,
                alignItems: "center",
                borderRadius: 9,
                paddingVertical: spacing[2],
                backgroundColor: selected ? colors.brand.primary : "transparent",
              }}
            >
              <Text
                numberOfLines={1}
                style={{
                  color: selected ? colors.brand.onPrimary : colors.text.secondary,
                  fontSize: typography.labelCaption.fontSize,
                  fontWeight: typography.labelButton.fontWeight,
                }}
              >
                {t(`sensor.mode.${option}`)}
              </Text>
            </View>
          );
        })}
      </View>

      <View
        onLayout={onLayout}
        style={{
          borderRadius: 12,
          borderWidth: 1,
          borderColor: colors.border.default,
          backgroundColor: colors.surface.raised,
          overflow: "hidden",
          // Time runs left to right in every language.
          direction: "ltr",
        }}
      >
        <Svg
          width={Math.max(width - 2, 1)}
          height={(Math.max(width - 2, 1) * VIEW_HEIGHT) / VIEW_WIDTH}
          viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        >
          {traces.map(({ axis, points }) => (
            <Polyline
              key={axis}
              points={points}
              fill="none"
              stroke={axisColor(colors, axis)}
              strokeWidth={1.6}
              strokeLinejoin="round"
            />
          ))}
        </Svg>
      </View>

      <View
        style={{
          flexDirection: "row",
          justifyContent: "center",
          gap: spacing[2],
          // Same left-to-right order as the traces above.
          direction: "ltr",
        }}
      >
        {AXES.map((axis) => (
          <View
            key={axis}
            style={{
              minWidth: 44,
              alignItems: "center",
              borderRadius: 999,
              paddingVertical: spacing[1],
              paddingHorizontal: spacing[3],
              backgroundColor: axisColor(colors, axis),
            }}
          >
            <Text
              style={{
                color: AXIS_CHIP_ON_FILL_TEXT,
                fontSize: typography.labelCaption.fontSize,
                fontWeight: "700",
              }}
            >
              {t(`sensor.axis${axis.toUpperCase()}`)}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}
