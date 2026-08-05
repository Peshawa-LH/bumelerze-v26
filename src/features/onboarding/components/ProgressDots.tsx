import { StyleSheet, View } from "react-native";

import { useTheme } from "@/theme";

interface ProgressDotsProps {
  totalSteps: number;
  /** 0-based index of the currently visible step. */
  currentIndex: number;
}

/**
 * Onboarding progress indicator (wave brief: "progress dots"). Plain `View`
 * dots, not an icon font — one less thing to translate/mirror, and the
 * active dot naturally reads in the right direction because RN mirrors
 * `flexDirection: "row"` for us once RTL is forced (design-language.md §5).
 */
export function ProgressDots({ totalSteps, currentIndex }: ProgressDotsProps) {
  const { colors, spacing } = useTheme();

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 1, max: totalSteps, now: currentIndex + 1 }}
      style={[styles.row, { gap: spacing[2] }]}
    >
      {Array.from({ length: totalSteps }).map((_, index) => (
        <View
          // Static, fixed-length, never reordered — index key is safe.
          key={index}
          style={[
            styles.dot,
            {
              backgroundColor:
                index === currentIndex ? colors.brand.primary : colors.border.default,
              width: index === currentIndex ? 20 : 8,
            },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
  },
  dot: {
    height: 8,
    borderRadius: 4,
  },
});
