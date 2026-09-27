import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme } from "@/theme";
import type { SensorView } from "../types";

interface ViewSwitchProps {
  value: SensorView;
  onChange: (view: SensorView) => void;
}

const OPTIONS: readonly { view: SensorView; icon: "pulse-outline" | "cube-outline" }[] = [
  { view: "traces", icon: "pulse-outline" },
  { view: "space", icon: "cube-outline" },
];

/** Two-way switch between the trace stack and the 3D view. */
export function ViewSwitch({ value, onChange }: ViewSwitchProps) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();

  return (
    <View
      accessibilityRole="tablist"
      style={[
        styles.track,
        { backgroundColor: colors.surface.sunken, borderColor: colors.border.subtle },
      ]}
    >
      {OPTIONS.map(({ view, icon }) => {
        const selected = view === value;
        const fg = selected ? colors.brand.onPrimary : colors.text.secondary;
        return (
          <Pressable
            key={view}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={t(`sensor.view.${view}`)}
            onPress={() => onChange(view)}
            style={[
              styles.option,
              {
                backgroundColor: selected ? colors.brand.primary : "transparent",
                paddingVertical: spacing[2],
                gap: spacing[2],
              },
            ]}
          >
            <Ionicons name={icon} size={18} color={fg} />
            <Text
              style={{
                color: fg,
                fontSize: typography.labelButton.fontSize,
                fontWeight: typography.labelButton.fontWeight,
              }}
            >
              {t(`sensor.view.${view}`)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: "row",
    borderRadius: 999,
    borderWidth: 1,
    padding: 3,
  },
  option: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 999,
    minHeight: 44,
  },
});
