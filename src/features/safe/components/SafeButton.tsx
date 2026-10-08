import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text } from "react-native";

import { useTheme } from "@/theme";

/** The "I'm safe" button: the largest control on its screen (at least 64 dp
 * tall, full width, 18 sp+ label, a check icon so colour is never the only
 * signal). One verb, no icon-only meaning. */
export function SafeButton({
  label,
  onPress,
  disabled = false,
  accessibilityHint,
  testID,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  accessibilityHint?: string;
  testID?: string;
}) {
  const { colors, typography, spacing } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      {...(accessibilityHint ? { accessibilityHint } : {})}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: disabled ? colors.surface.sunken : colors.brand.primary,
          paddingHorizontal: spacing[4],
          gap: spacing[3],
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      <Ionicons
        name="checkmark-circle"
        size={28}
        color={disabled ? colors.text.tertiary : colors.brand.onPrimary}
      />
      <Text
        style={{
          color: disabled ? colors.text.tertiary : colors.brand.onPrimary,
          fontSize: Math.max(20, typography.h3.fontSize),
          lineHeight: Math.max(26, typography.h3.lineHeight),
          fontWeight: "700",
          textAlign: "center",
          flexShrink: 1,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 64,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
  },
});
