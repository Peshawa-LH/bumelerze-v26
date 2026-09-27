import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme } from "@/theme";
import type { StationFreshness } from "../types";
import { freshnessColor } from "./colors";

const TIERS: readonly StationFreshness[] = ["live", "recent", "silent"];

/** What the three triangle colours mean. */
export function StationLegend() {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  return (
    <View style={[styles.row, { gap: spacing[4] }]}>
      {TIERS.map((tier) => (
        <View key={tier} style={[styles.item, { gap: spacing[1] }]}>
          <Ionicons name="triangle" size={12} color={freshnessColor(colors, tier)} />
          <Text
            style={{
              color: colors.text.secondary,
              fontSize: typography.labelCaption.fontSize,
              lineHeight: typography.labelCaption.lineHeight,
            }}
          >
            {t(`stations.tier.${tier}`)}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center" },
  item: { flexDirection: "row", alignItems: "center" },
});
