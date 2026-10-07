import { StyleSheet, Text, View } from "react-native";

import { useTheme } from "@/theme";

interface StaticPillProps {
  label: string;
  tone: "felt" | "brand";
  minWidth: number;
}

/** A still copy of the floating "I felt it!" / "Who felt it?" pills: the real
 * ones are absolutely positioned buttons that navigate, so the tour draws the
 * same look (colours, shape, size) in the flow of the preview instead. */
export function StaticPill({ label, tone, minWidth }: StaticPillProps) {
  const { colors, typography, spacing } = useTheme();
  const background = tone === "felt" ? colors.action.felt : colors.brand.primary;
  const foreground = tone === "felt" ? colors.action.feltOnFill : colors.brand.onPrimary;
  return (
    <View
      style={[
        styles.pill,
        {
          backgroundColor: background,
          paddingHorizontal: spacing[5],
          paddingVertical: spacing[4],
          minWidth,
        },
      ]}
    >
      <Text
        allowFontScaling
        style={{
          color: foreground,
          fontSize: typography.labelButton.fontSize,
          fontWeight: typography.labelButton.fontWeight,
        }}
      >
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    borderRadius: 999,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    elevation: 2,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
  },
});
