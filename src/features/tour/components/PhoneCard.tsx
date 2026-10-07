import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { useTheme } from "@/theme";

/**
 * The frame every tour preview sits in: a rounded raised panel with a border
 * and an inner "screen", so a live preview reads as an illustration of the
 * app rather than as a control. Wholly non-interactive and hidden from screen
 * readers; the stop's title and text carry the meaning.
 */
export function PhoneCard({ children }: { children: ReactNode }) {
  const { colors, spacing } = useTheme();
  return (
    <View
      testID="tour-phone-card"
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.frame,
        {
          backgroundColor: colors.surface.raised,
          borderColor: colors.border.default,
          padding: spacing[2],
        },
      ]}
    >
      <View
        style={[
          styles.screen,
          { backgroundColor: colors.surface.base, padding: spacing[3], gap: spacing[3] },
        ]}
      >
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    borderWidth: 1,
    borderRadius: 28,
    width: "100%",
    maxWidth: 420,
    alignSelf: "center",
  },
  screen: {
    borderRadius: 20,
    overflow: "hidden",
  },
});
