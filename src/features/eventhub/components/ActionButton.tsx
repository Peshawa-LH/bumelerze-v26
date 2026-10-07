import { Pressable, StyleSheet, Text } from "react-native";

import { useTheme } from "@/theme";

export interface ActionButtonProps {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  selected?: boolean;
  danger?: boolean;
  testID?: string;
}

/** Text-link style action, at least 44 px tall. */
export function ActionButton({
  label,
  onPress,
  disabled = false,
  selected = false,
  danger = false,
  testID,
}: ActionButtonProps) {
  const { colors, typography, spacing } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={4}
      testID={testID}
      style={[styles.action, { paddingHorizontal: spacing[2] }]}
    >
      <Text
        style={{
          color: danger
            ? colors.status.danger
            : disabled
              ? colors.text.tertiary
              : colors.text.link,
          fontSize: typography.bodyMeta.fontSize,
          fontWeight: selected ? "700" : typography.labelButton.fontWeight,
          textDecorationLine: selected ? "underline" : "none",
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  action: {
    minHeight: 44,
    minWidth: 44,
    justifyContent: "center",
    alignItems: "center",
  },
});
