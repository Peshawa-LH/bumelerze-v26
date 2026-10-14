import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme } from "@/theme";
import type { VcScenarios } from "../assessment";
import { VcBadge } from "./VcBadge";

const SCENARIOS = ["pessimistic", "mostLikely", "optimistic"] as const;

/**
 * The result as three classes side by side: pessimistic (the most vulnerable
 * end of the 80 % range), most likely (larger, in the middle) and optimistic
 * (the least vulnerable end). Every badge carries its letter, so the colour
 * never stands alone, and its spoken label names the scenario. The row
 * follows the reading direction, so in Sorani and Arabic pessimistic is on
 * the right.
 */
export function VcScenarioRow({
  scenarios,
  size = 88,
  testID,
}: {
  scenarios: VcScenarios;
  /** Diameter of the middle badge; the two ends are two thirds of it. */
  size?: number;
  testID?: string;
}) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  return (
    <View testID={testID} style={[styles.row, { gap: spacing[3] }]}>
      {SCENARIOS.map((key) => {
        const vc = scenarios[key];
        const label = t(`building.vc.scenario.${key}`);
        const middle = key === "mostLikely";
        return (
          <View key={key} style={[styles.cell, { gap: spacing[2] }]}>
            <VcBadge
              vc={vc}
              size={middle ? size : Math.round((size * 2) / 3)}
              label={t("building.vc.scenario.a11y", { scenario: label, vc })}
              {...(testID ? { testID: `${testID}-${key}` } : {})}
            />
            <Text
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={[
                typography.bodyMeta,
                styles.label,
                {
                  color: middle ? colors.text.primary : colors.text.secondary,
                  fontWeight: middle ? "700" : "400",
                },
              ]}
            >
              {label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "flex-end", justifyContent: "center" },
  cell: { flex: 1, alignItems: "center" },
  label: { textAlign: "center" },
});
