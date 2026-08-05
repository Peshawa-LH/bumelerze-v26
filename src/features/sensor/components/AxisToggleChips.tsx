import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme } from "@/theme";
import { AXIS_CHIP_ON_FILL_TEXT, axisColor } from "../colors";
import type { AxisKey, AxisVisibility } from "../types";

interface AxisToggleChipsProps {
  activeAxes: AxisVisibility;
  onToggle: (axis: AxisKey) => void;
}

const AXES: readonly AxisKey[] = ["x", "y", "z"];

/** X/Y/Z visibility toggles, color-matched to the chart's polylines so the
 * mapping between a chip and its line is immediate (design-language.md §1.4:
 * color is always paired with a label, never the sole carrier — the letter
 * label inside each chip is that pairing). */
export function AxisToggleChips({ activeAxes, onToggle }: AxisToggleChipsProps) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();

  return (
    <View style={[styles.row, { gap: spacing[2] }]}>
      {AXES.map((axis) => {
        const isActive = activeAxes[axis];
        const color = axisColor(colors, axis);
        const label = t(`sensor.axis${axis.toUpperCase()}`);

        return (
          <Pressable
            key={axis}
            accessibilityRole="button"
            accessibilityState={{ selected: isActive }}
            accessibilityLabel={label}
            accessibilityHint={t("sensor.axisA11yHint", { axis: axis.toUpperCase() })}
            onPress={() => onToggle(axis)}
            style={[
              styles.chip,
              {
                borderColor: color,
                backgroundColor: isActive ? color : "transparent",
                paddingHorizontal: spacing[3],
                paddingVertical: spacing[2],
              },
            ]}
          >
            <Text
              style={{
                color: isActive ? AXIS_CHIP_ON_FILL_TEXT : color,
                fontSize: typography.labelButton.fontSize,
                fontWeight: typography.labelButton.fontWeight,
              }}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
  },
  chip: {
    borderWidth: 1.5,
    borderRadius: 999,
    minWidth: 48,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
  },
});
