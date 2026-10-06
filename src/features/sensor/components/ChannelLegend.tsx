import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme } from "@/theme";
import { axisColor } from "../colors";
import type { PhonePose } from "../projection";
import type { AxisKey } from "../types";

const AXES: readonly AxisKey[] = ["x", "y", "z"];

interface ChannelLegendProps {
  /** With both set (the 3D view only), the row ends with a small button
   * that flips the drawn phone between standing and lying flat (owner,
   * 2026-09-27: "just a button like the legend"). */
  pose?: PhonePose;
  onTogglePose?: () => void;
}

/**
 * The three channel colours with their names. Display only (owner,
 * 2026-09-27: no per-channel on/off — the colours are a legend, not a
 * control); both figures use the same three colours.
 */
export function ChannelLegend({ pose, onTogglePose }: ChannelLegendProps = {}) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const labelStyle = {
    color: colors.text.secondary,
    fontSize: typography.labelButton.fontSize,
    fontWeight: typography.labelButton.fontWeight,
  } as const;

  return (
    <View style={[styles.row, { gap: spacing[4] }]}>
      {AXES.map((axis) => (
        <View key={axis} style={[styles.item, { gap: spacing[2] }]}>
          <View style={[styles.dot, { backgroundColor: axisColor(colors, axis) }]} />
          <Text style={labelStyle}>{t(`sensor.axis${axis.toUpperCase()}`)}</Text>
        </View>
      ))}
      {pose && onTogglePose ? (
        <Pressable
          testID="sensor-flip-phone"
          accessibilityRole="button"
          accessibilityLabel={t("sensor.flipPhone")}
          accessibilityValue={{ text: t(`sensor.pose.${pose}`) }}
          onPress={onTogglePose}
          hitSlop={12}
          style={({ pressed }) => [
            styles.item,
            styles.flip,
            {
              gap: spacing[1],
              paddingHorizontal: spacing[2],
              borderColor: colors.border.default,
              opacity: pressed ? 0.7 : 1,
            },
          ]}
        >
          <Ionicons
            name={pose === "flat" ? "phone-portrait-outline" : "phone-landscape-outline"}
            size={16}
            color={colors.text.secondary}
          />
          <Text style={labelStyle}>{t("sensor.flipPhone")}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", flexWrap: "wrap" },
  item: { flexDirection: "row", alignItems: "center" },
  dot: { width: 12, height: 12, borderRadius: 6 },
  flip: { marginStart: "auto", minHeight: 32, borderWidth: 1, borderRadius: 16 },
});
