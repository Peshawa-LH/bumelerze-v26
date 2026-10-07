import { Pressable, StyleSheet, Text } from "react-native";

import { useTheme } from "@/theme";

/** Text-style action, at least 44 px tall. */
export function LinkButton({
  label,
  onPress,
  danger = false,
  disabled = false,
  accessibilityLabel,
  testID,
}: {
  label: string;
  onPress: () => void;
  danger?: boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
  testID?: string;
}) {
  const { colors, typography, spacing } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={4}
      testID={testID}
      style={[styles.button, { paddingHorizontal: spacing[2] }]}
    >
      <Text
        style={{
          color: danger
            ? colors.status.danger
            : disabled
              ? colors.text.tertiary
              : colors.text.link,
          fontSize: typography.bodyMeta.fontSize,
          fontWeight: typography.labelButton.fontWeight,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { minHeight: 44, minWidth: 44, justifyContent: "center", alignItems: "center" },
});
