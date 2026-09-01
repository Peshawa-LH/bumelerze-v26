import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";

import type { TranslateFn } from "@/features/geo";
import { formatApproximate } from "@/lib/format-numbers";
import type { Theme } from "@/theme";

export interface RiskExposureTilesProps {
  exposedPopulation: number;
  buildingsInGrid: number;
  locale: string;
  t: TranslateFn;
  colors: Theme["colors"];
  typography: Theme["typography"];
  spacing: Theme["spacing"];
}

interface TileProps {
  testID: string;
  icon: "people" | "business";
  title: string;
  value: string;
  colors: Theme["colors"];
  typography: Theme["typography"];
  spacing: Theme["spacing"];
}

function Tile({ testID, icon, title, value, colors, typography, spacing }: TileProps) {
  return (
    <View
      testID={testID}
      accessible
      accessibilityLabel={`${title}. ${value}`}
      style={[
        styles.tile,
        { backgroundColor: colors.surface.raised, padding: spacing[4], gap: spacing[2] },
      ]}
    >
      <Ionicons name={icon} size={20} color={colors.text.secondary} />
      <Text
        style={{
          color: colors.text.secondary,
          fontSize: typography.labelCaption.fontSize,
          lineHeight: typography.labelCaption.lineHeight,
        }}
      >
        {title}
      </Text>
      <Text
        style={{
          color: colors.text.primary,
          fontSize: typography.h3.fontSize,
          lineHeight: typography.h3.lineHeight,
          fontWeight: typography.h3.fontWeight,
        }}
      >
        {value}
      </Text>
    </View>
  );
}

/**
 * Two rounded tiles — people and buildings in the shaken area, each a
 * single rounded 2-significant-figure figure (`formatApproximate`), never
 * the raw count (owner: "people understand visuals, not direct numbers").
 * `flexWrap`/`flexBasis` (not a hardcoded 2-column grid) so the pair
 * naturally stacks on narrow widths without a manual breakpoint read.
 */
export function RiskExposureTiles({
  exposedPopulation,
  buildingsInGrid,
  locale,
  t,
  colors,
  typography,
  spacing,
}: RiskExposureTilesProps) {
  return (
    <View style={[styles.row, { gap: spacing[3] }]}>
      <Tile
        testID="risk-exposure-tile-people"
        icon="people"
        title={t("eventDetail.risk.peopleTile.title")}
        value={t("eventDetail.risk.aboutValue", {
          value: formatApproximate(exposedPopulation, locale, t),
        })}
        colors={colors}
        typography={typography}
        spacing={spacing}
      />
      <Tile
        testID="risk-exposure-tile-buildings"
        icon="business"
        title={t("eventDetail.risk.buildingsTile.title")}
        value={t("eventDetail.risk.aboutValue", {
          value: formatApproximate(buildingsInGrid, locale, t),
        })}
        colors={colors}
        typography={typography}
        spacing={spacing}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  tile: {
    flexGrow: 1,
    flexBasis: 140,
    borderRadius: 12,
  },
});
