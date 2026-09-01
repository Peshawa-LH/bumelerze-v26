import { StyleSheet, Text, View } from "react-native";

import type { TranslateFn } from "@/features/geo";
import { formatApproximate } from "@/lib/format-numbers";
import type { Theme } from "@/theme";
import { classifyDamageBand } from "../risk-alert";
import type { RiskDistrict } from "../types";
import { damageBandColor } from "./RiskDamageBandTag";

export interface RiskProvinceRowProps {
  district: RiskDistrict;
  /** The worst (first, since `districts` is already producer-sorted
   * worst-first) province's own P50 — every row's bar length is relative
   * to this, so the worst province always reads as the full-length bar
   * and every other row reads proportionally shorter. */
  worstBuildingsHeavy: number;
  locale: string;
  t: TranslateFn;
  colors: Theme["colors"];
  typography: Theme["typography"];
  spacing: Theme["spacing"];
}

/** Relative bar length — linear (not log) against the WORST province in
 * this event, not the impact scale's own fixed log domain: this list is
 * about comparing provinces to EACH OTHER within one event, where the
 * impact scale (`RiskImpactScale.tsx`) is about placing one event-wide
 * figure on a fixed, comparable-across-events axis. Guards against a
 * zero/negative `worstBuildingsHeavy` (would only happen for a
 * pathological all-zero product). */
function relativeFraction(value: number, worst: number): number {
  if (worst <= 0) {
    return 0;
  }
  return Math.min(1, Math.max(0, value / worst));
}

function relativeWidthPercent(value: number, worst: number): `${number}%` {
  return `${(relativeFraction(value, worst) * 100).toFixed(2)}%` as `${number}%`;
}

/** Coverage below this fraction gets the "partly inside map" tag — the
 * same "a low value means a partial-coverage undercount, not a confident
 * total" reasoning `types.ts`'s own `RiskDistrict.coverage` doc comment
 * documents. */
const LOW_COVERAGE_THRESHOLD = 0.5;

export function RiskProvinceRow({
  district,
  worstBuildingsHeavy,
  locale,
  t,
  colors,
  typography,
  spacing,
}: RiskProvinceRowProps) {
  const band = classifyDamageBand(district.buildingsHeavy);
  const [p05, , p95] = district.buildingsHeavyP05P50P95;
  const barWidth = relativeWidthPercent(district.buildingsHeavy, worstBuildingsHeavy);
  const whiskerStartFraction = relativeFraction(p05, worstBuildingsHeavy);
  const whiskerEndFraction = relativeFraction(p95, worstBuildingsHeavy);
  const whiskerLeft = `${(whiskerStartFraction * 100).toFixed(2)}%` as `${number}%`;
  const whiskerWidth = `${(Math.max(0, whiskerEndFraction - whiskerStartFraction) * 100).toFixed(2)}%` as `${number}%`;
  const isPartlyInsideMap = district.coverage < LOW_COVERAGE_THRESHOLD;

  const captionValue = formatApproximate(district.buildingsHeavy, locale, t);
  const a11yLabel = t("eventDetail.risk.provinceRowA11y", {
    province: district.adm1Name,
    band: t(`eventDetail.risk.band.${band}.title`),
    value: captionValue,
  });

  return (
    <View
      testID="risk-province-row"
      accessible
      accessibilityLabel={a11yLabel}
      style={[
        styles.card,
        { backgroundColor: colors.surface.raised, padding: spacing[3], gap: spacing[2] },
      ]}
    >
      <View style={styles.headerRow}>
        <Text
          style={{
            color: colors.text.primary,
            fontSize: typography.bodyDefault.fontSize,
            lineHeight: typography.bodyDefault.lineHeight,
            flexShrink: 1,
          }}
          numberOfLines={1}
        >
          {district.adm1Name}
        </Text>
        <View style={[styles.tagsRow, { gap: spacing[1] }]}>
          {isPartlyInsideMap ? (
            <View
              testID="risk-province-row-coverage-tag"
              style={[styles.tag, { backgroundColor: colors.surface.sunken }]}
            >
              <Text style={{ color: colors.text.tertiary, fontSize: 10, fontWeight: "600" }}>
                {t("eventDetail.risk.partlyInsideMap")}
              </Text>
            </View>
          ) : null}
          <View
            testID="risk-province-row-band-tag"
            style={[styles.tag, { backgroundColor: damageBandColor(band, colors) }]}
          >
            <Text style={{ color: colors.text.inverse, fontSize: 10, fontWeight: "700" }}>
              {t(`eventDetail.risk.band.${band}.title`)}
            </Text>
          </View>
        </View>
      </View>

      {/* Same non-mirroring rule as the impact scale/damage bar — the
       * relative-length bar always reads left to right regardless of
       * locale. */}
      <View style={[styles.barTrack, { direction: "ltr" }]}>
        <View
          testID="risk-province-row-whisker"
          style={[
            styles.whisker,
            { left: whiskerLeft, width: whiskerWidth, backgroundColor: colors.surface.overlay },
          ]}
        />
        <View
          testID="risk-province-row-bar"
          style={[styles.bar, { width: barWidth, backgroundColor: damageBandColor(band, colors) }]}
        />
      </View>

      <Text
        style={{
          color: colors.text.tertiary,
          fontSize: typography.labelCaption.fontSize,
          lineHeight: typography.labelCaption.lineHeight,
        }}
      >
        {t("eventDetail.risk.provinceCaption", { value: captionValue })}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  tagsRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  tag: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  barTrack: {
    height: 8,
    borderRadius: 999,
    overflow: "hidden",
    position: "relative",
  },
  whisker: {
    position: "absolute",
    top: 0,
    bottom: 0,
    borderRadius: 999,
  },
  bar: {
    height: 8,
    borderRadius: 999,
  },
});
