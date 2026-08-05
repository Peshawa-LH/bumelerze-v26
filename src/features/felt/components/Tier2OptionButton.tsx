import { Pressable, StyleSheet, Text } from "react-native";

import { useTheme } from "@/theme";

interface Tier2OptionButtonProps {
  label: string;
  onPress: () => void;
}

/**
 * One answer option in the tier-2 question flow. Tapping an option both
 * records the answer AND advances to the next question (same one-tap
 * philosophy as tier 1's cartoon grid) — there is no separate "confirm"
 * step, keeping an 11-question flow fast to move through.
 */
export function Tier2OptionButton({ label, onPress }: Tier2OptionButtonProps) {
  const { colors, typography, spacing } = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        {
          borderColor: colors.border.default,
          backgroundColor: pressed ? colors.surface.raised : "transparent",
          paddingVertical: spacing[3],
          paddingStart: spacing[4],
          paddingEnd: spacing[4],
        },
      ]}
    >
      <Text
        allowFontScaling
        style={{
          color: colors.text.primary,
          fontSize: typography.bodyDefault.fontSize,
          lineHeight: typography.bodyDefault.lineHeight,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    borderWidth: 1,
    borderRadius: 10,
  },
});
