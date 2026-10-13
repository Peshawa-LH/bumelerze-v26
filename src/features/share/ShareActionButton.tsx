import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, Pressable, StyleSheet, Text } from "react-native";

import { useTheme } from "@/theme";

/** One full-width action of the share sheet (link, image, post, copy). */
export function ShareActionButton({
  testID,
  label,
  icon,
  primary = false,
  quiet = false,
  busy = false,
  disabled = false,
  onPress,
}: {
  testID: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  primary?: boolean;
  quiet?: boolean;
  busy?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const { colors, typography, spacing } = useTheme();
  const foreground = primary ? colors.brand.onPrimary : colors.brand.primary;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, busy }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          minHeight: 52,
          paddingHorizontal: spacing[4],
          gap: spacing[2],
          backgroundColor: primary ? colors.brand.primary : "transparent",
          borderColor: quiet ? "transparent" : colors.brand.primary,
          opacity: disabled ? 0.55 : pressed ? 0.85 : 1,
        },
      ]}
    >
      {busy ? (
        <ActivityIndicator size="small" color={foreground} />
      ) : (
        <Ionicons name={icon} size={22} color={foreground} />
      )}
      <Text
        style={{
          color: foreground,
          fontSize: typography.labelButton.fontSize,
          lineHeight: typography.labelButton.lineHeight,
          fontWeight: typography.labelButton.fontWeight,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderRadius: 14,
  },
});
