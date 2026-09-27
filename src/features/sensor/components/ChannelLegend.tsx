import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme } from "@/theme";
import { axisColor } from "../colors";
import type { AxisKey } from "../types";

const AXES: readonly AxisKey[] = ["x", "y", "z"];

/**
 * The three channel colours with their names. Display only (owner,
 * 2026-09-27: no per-channel on/off — the colours are a legend, not a
 * control); both figures use the same three colours.
 */
export function ChannelLegend() {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();

  return (
    <View style={[styles.row, { gap: spacing[4] }]}>
      {AXES.map((axis) => (
        <View key={axis} style={[styles.item, { gap: spacing[2] }]}>
          <View style={[styles.dot, { backgroundColor: axisColor(colors, axis) }]} />
          <Text
            style={{
              color: colors.text.secondary,
              fontSize: typography.labelButton.fontSize,
              fontWeight: typography.labelButton.fontWeight,
            }}
          >
            {t(`sensor.axis${axis.toUpperCase()}`)}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", flexWrap: "wrap" },
  item: { flexDirection: "row", alignItems: "center" },
  dot: { width: 12, height: 12, borderRadius: 6 },
});
