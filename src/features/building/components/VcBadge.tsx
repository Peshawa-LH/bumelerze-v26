import { StyleSheet, Text, View } from "react-native";

import { useTheme } from "@/theme";
import type { VulnerabilityClass } from "../ims25";

/** Fill colour of a vulnerability class: A and B red, C amber, D blue, E and
 * F green. The letter carries the meaning; colour only reinforces it. */
function fillFor(
  vc: VulnerabilityClass,
  status: ReturnType<typeof useTheme>["colors"]["status"],
) {
  switch (vc) {
    case "A":
    case "B":
      return status.danger;
    case "C":
      return status.warning;
    case "D":
      return status.info;
    default:
      return status.success;
  }
}

/** The big round "A..F" badge. */
export function VcBadge({
  vc,
  size = 72,
  label,
  testID,
}: {
  vc: VulnerabilityClass;
  size?: number;
  /** Spoken label; the visible content is only the letter. */
  label: string;
  testID?: string;
}) {
  const { colors, typography } = useTheme();
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={label}
      testID={testID}
      style={[
        styles.badge,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: fillFor(vc, colors.status),
        },
      ]}
    >
      <Text
        style={{
          color: colors.brand.onPrimary,
          fontSize: Math.round(size * 0.5),
          lineHeight: Math.round(size * 0.62),
          fontWeight: "800",
          fontFamily: typography.h1.fontFamily,
        }}
      >
        {vc}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { alignItems: "center", justifyContent: "center" },
});
