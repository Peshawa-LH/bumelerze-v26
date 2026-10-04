import { Ionicons } from "@expo/vector-icons";
import { useState, type ReactNode } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { DirectionalChevron } from "@/components/DirectionalChevron";
import { useTheme } from "@/theme";

export type SettingsRowTrailing = "chevron" | "expand" | "none";

interface SettingsRowProps {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  /** Plain value at the end, e.g. the HomeBase town. */
  value?: string | null;
  /** Small extra node between value and chevron (e.g. the "set automatically" mark). */
  valueAccessory?: ReactNode;
  onPress?: () => void;
  trailing?: SettingsRowTrailing;
  /** For `trailing="expand"`: whether the row is open. */
  expanded?: boolean;
  disabled?: boolean;
  accessibilityHint?: string;
  /** Overrides the spoken label (default: "label, value"). */
  accessibilityLabel?: string;
  testID?: string;
}

/** A 56 dp settings row: start icon, label, optional value, then a chevron
 * (mirrored in RTL) or an expand caret (never mirrored). Pressed and web
 * hover = `surface.sunken`; keyboard focus on web = 2 px brand outline. */
export function SettingsRow({
  icon,
  label,
  value,
  valueAccessory,
  onPress,
  trailing = "chevron",
  expanded = false,
  disabled = false,
  accessibilityHint,
  accessibilityLabel,
  testID,
}: SettingsRowProps) {
  const { colors, typography, spacing } = useTheme();
  const [focused, setFocused] = useState(false);
  const isWeb = Platform.OS === "web";

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? (value ? `${label}, ${value}` : label)}
      accessibilityHint={accessibilityHint}
      accessibilityState={trailing === "expand" ? { expanded, disabled } : { disabled }}
      disabled={disabled}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={(state) => [
        styles.row,
        {
          paddingHorizontal: spacing[4],
          gap: spacing[3],
          backgroundColor:
            state.pressed || (state as { hovered?: boolean }).hovered
              ? colors.surface.sunken
              : "transparent",
          opacity: disabled ? 0.6 : 1,
        },
        isWeb && focused
          ? {
              outlineWidth: 2,
              outlineStyle: "solid",
              outlineColor: colors.brand.primary,
              outlineOffset: -2,
            }
          : null,
      ]}
    >
      <Ionicons name={icon} size={24} color={colors.text.secondary} />
      <Text
        style={[typography.bodyDefault, styles.label, { color: colors.text.primary }]}
      >
        {label}
      </Text>
      {value ? (
        <Text
          style={[typography.bodyDefault, styles.value, { color: colors.text.secondary }]}
          numberOfLines={2}
        >
          {value}
        </Text>
      ) : null}
      {valueAccessory}
      {trailing === "chevron" ? <DirectionalChevron /> : null}
      {trailing === "expand" ? (
        <Ionicons
          name={expanded ? "chevron-up" : "chevron-down"}
          size={20}
          color={colors.text.tertiary}
        />
      ) : null}
    </Pressable>
  );
}

/** Space reserved for content shown under a row (pickers, details). */
export function SettingsRowBody({ children }: { children: ReactNode }) {
  const { spacing } = useTheme();
  return (
    <View
      style={{
        paddingHorizontal: spacing[4],
        paddingBottom: spacing[4],
        gap: spacing[3],
      }}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: 56, flexDirection: "row", alignItems: "center" },
  label: { flexShrink: 1, flexGrow: 1 },
  value: { flexShrink: 1, textAlign: "auto" },
});
