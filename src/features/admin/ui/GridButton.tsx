import Ionicons from "@expo/vector-icons/Ionicons";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { withAlpha } from "@/features/badges/tones";
import { useTheme } from "@/theme";
import { useTextDir } from "./text-dir";

export type GridButtonTone = "primary" | "secondary" | "danger";

/**
 * One button of a two-column action grid (person page, mockup 5c). Primary =
 * filled brand colour (the main action, first); danger = red, placed last by
 * the caller, with a one-line consequence under the label.
 */
export function GridButton({
  icon,
  label,
  detail,
  tone = "secondary",
  disabled = false,
  onPress,
  testID,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  detail?: string | undefined;
  tone?: GridButtonTone;
  disabled?: boolean;
  onPress: () => void;
  testID?: string;
}) {
  const { colors, typography, spacing } = useTheme();
  const dir = useTextDir();
  const fg =
    tone === "primary"
      ? colors.brand.onPrimary
      : tone === "danger"
        ? colors.status.danger
        : colors.text.primary;
  const bg =
    tone === "primary"
      ? colors.brand.primary
      : tone === "danger"
        ? withAlpha(colors.status.danger, 0.08)
        : colors.surface.raised;
  const border =
    tone === "primary"
      ? colors.brand.primary
      : tone === "danger"
        ? colors.status.danger
        : colors.border.default;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={detail ? `${label}. ${detail}` : label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: bg,
          borderColor: border,
          padding: spacing[3],
          gap: 2,
          opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
        },
      ]}
    >
      <View style={[styles.row, { gap: spacing[2] }]}>
        <Ionicons name={icon} size={20} color={fg} />
        <Text style={[typography.labelButton, dir, styles.label, { color: fg }]}>
          {label}
        </Text>
      </View>
      {detail ? (
        <Text
          style={[
            typography.labelCaption,
            dir,
            {
              color: tone === "primary" ? colors.brand.onPrimary : colors.text.secondary,
            },
          ]}
        >
          {detail}
        </Text>
      ) : null}
    </Pressable>
  );
}

/** Two buttons per row (each a little under half the width, so they wrap). */
export function ActionGrid({
  children,
  testID,
}: {
  children: ReactNode;
  testID?: string;
}) {
  const { spacing } = useTheme();
  return (
    <View testID={testID} style={[styles.grid, { gap: spacing[2] }]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap" },
  button: {
    flexBasis: "47%",
    flexGrow: 1,
    maxWidth: "50%",
    minHeight: 52,
    borderWidth: 1,
    borderRadius: 12,
    justifyContent: "center",
  },
  row: { flexDirection: "row", alignItems: "center" },
  label: { flexShrink: 1 },
});
