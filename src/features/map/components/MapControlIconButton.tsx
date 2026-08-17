import { Ionicons } from "@expo/vector-icons";
import type { ComponentProps } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { useTheme } from "@/theme";

interface MapControlIconButtonProps {
  icon: ComponentProps<typeof Ionicons>["name"];
  accessibilityLabel: string;
  /** Shows a small badge dot when the control it collapses has a
   * non-default selection (an active filter, a non-default basemap style)
   * — "keep the currently active state legible when collapsed" (wave
   * brief). Purely decorative; the same information is already carried in
   * `accessibilityLabel`. */
  isActive: boolean;
  onPress: () => void;
}

/**
 * The collapsed (icon-only) form the map's filter/style controls take at
 * phone width (`MAP_CONTROLS_COMPACT_MAX_WIDTH_PX`, `responsive.ts`) —
 * Problem 1: "controls crowd the map at phone width". A single 44x44dp
 * round button, matching the app's touch-target floor everywhere else;
 * pressing it hands off to the caller's own expand/collapse toggle
 * (`MapFilterPanel`/`MapStylePicker`), which then render their full header
 * + body as an absolutely-positioned popover instead of this button — see
 * those components' own doc comments.
 *
 * `accessibilityState={{ expanded: false }}` is always correct here since
 * this button only ever renders in the COLLAPSED state (the popover reuses
 * the original header, which sets `expanded: true` itself once open).
 */
export function MapControlIconButton({
  icon,
  accessibilityLabel,
  isActive,
  onPress,
}: MapControlIconButtonProps) {
  const { colors } = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded: false }}
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      hitSlop={4}
      style={[
        styles.button,
        { borderColor: colors.border.default, backgroundColor: colors.surface.raised },
      ]}
    >
      <Ionicons name={icon} size={20} color={colors.text.primary} />
      {isActive ? (
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[
            styles.activeDot,
            { backgroundColor: colors.brand.primary, borderColor: colors.surface.raised },
          ]}
        />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minWidth: 44,
    minHeight: 44,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  activeDot: {
    position: "absolute",
    top: -2,
    end: -2,
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 1.5,
  },
});
