import { StyleSheet, Text, View } from "react-native";

import type { TranslateFn } from "@/features/geo";
import type { Theme } from "@/theme";
import { DAMAGE_GRADE_LABELS } from "../damage-ramp";
import { intensityLegendLabels } from "../intensity-format";

/** Which contour layer the map is currently painting — a small toggle
 * above the map switches between the two when a damage product exists
 * (owner: intensity is the default, damage is opt-in). Shared between
 * both renderers (`ShakeMapViewSvg.tsx`, `ShakeMapView.web.tsx`) and
 * `ShakeMapLayerToggle`/this module, so there is exactly one definition of
 * "which layers exist" for the whole feature. */
export type ShakeMapLayer = "intensity" | "damage";

function rampColor(colors: Theme["colors"], level: number): string {
  return colors.intensity[level] ?? colors.intensity[1] ?? colors.status.warning;
}

function damageColor(colors: Theme["colors"], level: number): string {
  return colors.damageGrade[level] ?? colors.damageGrade[1] ?? colors.status.warning;
}

export interface ShakeMapLegendProps {
  layer: ShakeMapLayer;
  /** Picks Roman numerals (en, kmr) or digits (ckb, ar) for intensity. */
  locale: string;
  t: TranslateFn;
  colors: Theme["colors"];
  typography: Theme["typography"];
  spacing: Theme["spacing"];
}

/**
 * The caption + fixed color-ramp swatch strip shown under one event's
 * SHAKEmap — factored out of `ShakeMapViewSvg.tsx` (web-map wave) so the
 * MapLibre renderer (`ShakeMapView.web.tsx`) shows the EXACT same legend
 * copy/colors/ordering even though the two views paint the map itself
 * through entirely different APIs (SVG polygons vs. MapLibre GL layers) —
 * one shared component, never two copies that could drift.
 *
 * Same "non-mirroring" rule as the map itself (`direction: "ltr"` here is
 * deliberate, not a bug): intensity numerals (Roman in en and kmr, digits in
 * ckb and ar) or DG codes (damage)
 * always read left to right regardless of locale, matching how the maps
 * underneath never mirror either.
 */
export function ShakeMapLegend({
  layer,
  locale,
  t,
  colors,
  typography,
  spacing,
}: ShakeMapLegendProps) {
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
        {layer === "damage"
          ? t("eventDetail.shakemap.legendCaptionDamage")
          : t("eventDetail.shakemap.legendCaption")}
      </Text>
      <View
        style={[styles.legendRow, { direction: "ltr", gap: spacing[1] }]}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {layer === "intensity"
          ? intensityLegendLabels(locale).map(({ level, label: numeral }) => {
              return (
                <View key={level} style={styles.legendItem}>
                  <View
                    style={[
                      styles.legendSwatch,
                      { backgroundColor: rampColor(colors, level) },
                    ]}
                  />
                  <Text
                    style={{
                      color: colors.text.secondary,
                      fontSize: 9,
                      fontWeight: "600",
                    }}
                  >
                    {numeral}
                  </Text>
                </View>
              );
            })
          : DAMAGE_GRADE_LABELS.slice(1).map((label, index) => {
              const level = index + 1;
              return (
                <View key={level} style={styles.legendItem}>
                  <View
                    style={[
                      styles.legendSwatch,
                      { backgroundColor: damageColor(colors, level) },
                    ]}
                  />
                  <Text
                    style={{
                      color: colors.text.secondary,
                      fontSize: 9,
                      fontWeight: "600",
                    }}
                  >
                    {label}
                  </Text>
                </View>
              );
            })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  legendRow: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  legendItem: {
    alignItems: "center",
    width: 24,
  },
  legendSwatch: {
    width: 16,
    height: 10,
    borderRadius: 2,
  },
});
