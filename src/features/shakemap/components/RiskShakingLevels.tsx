import { StyleSheet, Text, View } from "react-native";

import type { TranslateFn } from "@/features/geo";
import { formatApproximate } from "@/lib/format-numbers";
import type { Theme } from "@/theme";

import { INTENSITY_ROMAN_NUMERALS } from "../intensity-ramp";
import type { RiskPopulationByIntensity } from "../types";

export interface RiskShakingLevelsProps {
  populationByIntensity: RiskPopulationByIntensity;
  locale: string;
  t: TranslateFn;
  colors: Theme["colors"];
  typography: Theme["typography"];
  spacing: Theme["spacing"];
}

/** Degrees below this are "felt, no damage expected" and are not worth a
 * row of their own on a panic-time screen; they stay in the product and
 * in the total. */
const LOWEST_DEGREE_SHOWN = 4;

/**
 * People by how hard the ground actually moved where they live.
 *
 * This replaces "People in the shaken area", which counted everyone
 * inside the map window: on the 2017 Iran-Iraq event that was 32.7
 * million, essentially the population of Iraq, and it read as though 32.7
 * million people were affected. The same people binned by whole IMS-25
 * degree say something true instead, and the degrees are the ones the map
 * legend colours, so a number here and a colour on the map cannot
 * disagree about a place.
 *
 * Rows are ordered strongest first: the reader is looking for the worst
 * line, not for a distribution.
 */
export function RiskShakingLevels({
  populationByIntensity,
  locale,
  t,
  colors,
  typography,
  spacing,
}: RiskShakingLevelsProps) {
  const rows = Object.entries(populationByIntensity)
    .map(([degree, people]) => ({ degree: Number(degree), people }))
    .filter((row) => row.degree >= LOWEST_DEGREE_SHOWN && row.people > 0)
    .sort((a, b) => b.degree - a.degree);

  if (rows.length === 0) {
    return null;
  }

  const widest = Math.max(...rows.map((row) => row.people));

  return (
    <View style={{ gap: spacing[2] }}>
      <Text
        style={{
          color: colors.text.secondary,
          fontSize: typography.labelCaption.fontSize,
          lineHeight: typography.labelCaption.lineHeight,
          fontWeight: typography.labelCaption.fontWeight,
        }}
      >
        {t("eventDetail.risk.shakingLevels.title")}
      </Text>

      {rows.map((row) => {
        const numeral = INTENSITY_ROMAN_NUMERALS[row.degree] ?? String(row.degree);
        const value = formatApproximate(row.people, locale, t);
        return (
          <View
            key={row.degree}
            testID={`risk-shaking-level-${row.degree}`}
            style={styles.row}
            accessibilityRole="text"
            accessibilityLabel={t("eventDetail.risk.shakingLevels.a11yRow", {
              level: t(`eventDetail.risk.shakingLevels.degree.${row.degree}`, {
                defaultValue: numeral,
              }),
              value,
            })}
          >
            <Text
              style={[
                styles.numeral,
                {
                  color: colors.text.primary,
                  fontSize: typography.labelCaption.fontSize,
                  fontWeight: "600",
                },
              ]}
            >
              {numeral}
            </Text>

            <View style={[styles.track, { backgroundColor: colors.border.subtle }]}>
              <View
                style={{
                  width: `${Math.max(2, (row.people / widest) * 100)}%`,
                  height: "100%",
                  borderRadius: 3,
                  backgroundColor: colors.intensity[row.degree] ?? colors.status.warning,
                }}
              />
            </View>

            <Text
              style={{
                color: colors.text.secondary,
                fontSize: typography.labelCaption.fontSize,
                lineHeight: typography.labelCaption.lineHeight,
              }}
            >
              {value}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  // Fixed so the numerals form a column and the bars all start together,
  // in either writing direction.
  numeral: { minWidth: 26 },
  track: { flex: 1, height: 6, borderRadius: 3, overflow: "hidden" },
});
