import { StyleSheet, Text, View } from "react-native";

import { useTheme } from "@/theme";
import type { VulnerabilityClass } from "../ims25";

/** Vulnerability class colours from the owner's building-stock surveys
 * (Hasan et al., WCEE 2024, Hawler; Hasan et al., 3CroCEE 2025,
 * Sulaimani), sampled from the published legends. Same in light and dark
 * mode. The letter carries the meaning; colour only reinforces it, so the
 * pale classes get dark text. */
export const VC_COLORS: Record<VulnerabilityClass, { fill: string; text: string }> = {
  A: { fill: "#E73710", text: "#FFFFFF" },
  B: { fill: "#F3A3A2", text: "#1C1B1F" },
  C: { fill: "#DFF3AE", text: "#1C1B1F" },
  D: { fill: "#AAADFC", text: "#1C1B1F" },
  E: { fill: "#545FF9", text: "#FFFFFF" },
  F: { fill: "#58135B", text: "#FFFFFF" },
};

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
  const { typography } = useTheme();
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
          backgroundColor: VC_COLORS[vc].fill,
        },
      ]}
    >
      <Text
        style={{
          color: VC_COLORS[vc].text,
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
