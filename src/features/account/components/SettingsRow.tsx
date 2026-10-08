import { Ionicons } from "@expo/vector-icons";
import type { ReactNode } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { DirectionalChevron } from "@/components/DirectionalChevron";
import { useTheme } from "@/theme";

import { useFocusVisible } from "./use-focus-visible";

/** "external" = opens a web page outside the app (an "open in new" mark that
 * is never mirrored, unlike the chevron). */
export type SettingsRowTrailing = "chevron" | "expand" | "external" | "none";

interface SettingsRowProps {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  /** Plain value at the end, e.g. the language. */
  value?: string | null;
  /** Small extra node between value and chevron (e.g. a small status mark). */
  valueAccessory?: ReactNode;
  /** "stacked" puts the value on its own line under the label, for a value
   * too long to share a phone-width row (e.g. "Duhok · Location off"). */
  valueLayout?: "inline" | "stacked";
  /** How many lines a stacked value may take before it is cut (default 2).
   * Raise it for credit lines that must be read in full. */
  valueLines?: number;
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
 * hover = `surface.sunken`; keyboard focus on web = 2 px brand outline
 * (`:focus-visible` semantics: not after a tap or click). */
export function SettingsRow({
  icon,
  label,
  value,
  valueAccessory,
  valueLayout = "inline",
  valueLines = 2,
  onPress,
  trailing = "chevron",
  expanded = false,
  disabled = false,
  accessibilityHint,
  accessibilityLabel,
  testID,
}: SettingsRowProps) {
  const { colors, typography, spacing } = useTheme();
  const { i18n } = useTranslation();
  // The row's text follows the app language, not its own first letter: a
  // Latin name such as "USGS" in a Sorani row starts at the right edge like
  // the Sorani line under it.
  const direction = { writingDirection: i18n.dir() } as const;
  const { focusVisible, onFocus, onBlur } = useFocusVisible();
  const isWeb = Platform.OS === "web";

  return (
    <Pressable
      testID={testID}
      accessibilityRole={trailing === "external" ? "link" : "button"}
      accessibilityLabel={accessibilityLabel ?? (value ? `${label}, ${value}` : label)}
      accessibilityHint={accessibilityHint}
      accessibilityState={trailing === "expand" ? { expanded, disabled } : { disabled }}
      disabled={disabled}
      onPress={onPress}
      onFocus={onFocus}
      onBlur={onBlur}
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
        isWeb && focusVisible
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
      {valueLayout === "stacked" ? (
        <View style={styles.label}>
          <Text
            style={[typography.bodyDefault, direction, { color: colors.text.primary }]}
          >
            {label}
          </Text>
          {value ? (
            <Text
              style={[
                typography.bodyMeta,
                styles.value,
                direction,
                { color: colors.text.secondary },
              ]}
              numberOfLines={valueLines}
            >
              {value}
            </Text>
          ) : null}
        </View>
      ) : (
        <Text
          style={[typography.bodyDefault, styles.label, { color: colors.text.primary }]}
        >
          {label}
        </Text>
      )}
      {value && valueLayout === "inline" ? (
        <Text
          style={[typography.bodyDefault, styles.value, { color: colors.text.secondary }]}
          numberOfLines={2}
        >
          {value}
        </Text>
      ) : null}
      {valueAccessory}
      {trailing === "chevron" ? <DirectionalChevron /> : null}
      {trailing === "external" ? (
        <Ionicons name="open-outline" size={20} color={colors.text.tertiary} />
      ) : null}
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
        paddingTop: spacing[2],
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
