import { Pressable, StyleSheet, Text } from "react-native";

import { useTheme } from "@/theme";

export type AccountButtonTone = "primary" | "secondary" | "destructive" | "destructiveSolid";

interface AccountButtonProps {
  label: string;
  onPress: () => void;
  tone?: AccountButtonTone;
  disabled?: boolean;
  /** Overrides the spoken label (defaults to `label`). */
  accessibilityLabel?: string;
  testID?: string;
}

/** Full-width, >= 48 px tall button used by every account screen. */
export function AccountButton({
  label,
  onPress,
  tone = "secondary",
  disabled = false,
  accessibilityLabel,
  testID,
}: AccountButtonProps) {
  const { colors, typography, spacing } = useTheme();

  const solid = tone === "primary" || tone === "destructiveSolid";
  const backgroundColor = disabled
    ? colors.surface.raised
    : tone === "primary"
      ? colors.brand.primary
      : tone === "destructiveSolid"
        ? colors.status.danger
        : "transparent";
  const borderColor = disabled
    ? colors.border.default
    : tone === "destructive" || tone === "destructiveSolid"
      ? colors.status.danger
      : tone === "primary"
        ? colors.brand.primary
        : colors.border.default;
  const textColor = disabled
    ? colors.text.tertiary
    : solid
      ? colors.brand.onPrimary
      : tone === "destructive"
        ? colors.status.danger
        : colors.text.primary;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor,
          borderColor,
          paddingVertical: spacing[3],
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      <Text
        style={{
          color: textColor,
          fontSize: typography.labelButton.fontSize,
          lineHeight: typography.labelButton.lineHeight,
          fontWeight: typography.labelButton.fontWeight,
          textAlign: "center",
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
});
