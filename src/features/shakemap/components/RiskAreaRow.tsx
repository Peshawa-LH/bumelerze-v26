import { StyleSheet, Text, View } from "react-native";

import type { TranslateFn } from "@/features/geo";
import { formatApproximate } from "@/lib/format-numbers";
import type { Theme } from "@/theme";
import { classifyDamageBand } from "../risk-alert";
import type { RiskArea } from "../types";
import { damageBandColor } from "./RiskDamageBandTag";

export interface RiskAreaRowProps {
  area: RiskArea;
  /** The worst (first, since each level's row array is already
   * producer-sorted worst-first) area's own P50 within the CURRENTLY
   * SELECTED level — every row's bar length is relative to that, same
   * "worst reads as full-length, everything else proportionally shorter"
   * contract `RiskProvinceRow`'s own doc comment documents (this row is
   * the multi-level sibling of that one; see this file's own module doc
   * comment for the exact field-shape difference). */
  worstBuildingsHeavy: number;
  locale: string;
  t: TranslateFn;
  colors: Theme["colors"];
  typography: Theme["typography"];
  spacing: Theme["spacing"];
}

/** Same relative-bar math as `RiskProvinceRow.tsx` — duplicated rather than
 * imported (this repo's own precedent for small pure per-component helpers,
 * e.g. `live-transport.ts`'s `eventUuidCache` doc comment: "duplicate the
 * small thing, don't couple two components' internals together"). */
function relativeFraction(value: number, worst: number): number {
  if (worst <= 0) {
    return 0;
  }
  return Math.min(1, Math.max(0, value / worst));
}

function relativeWidthPercent(value: number, worst: number): `${number}%` {
  return `${(relativeFraction(value, worst) * 100).toFixed(2)}%` as `${number}%`;
}

/** Same threshold/reasoning as `RiskProvinceRow.tsx`'s own constant. */
const LOW_COVERAGE_THRESHOLD = 0.5;

/**
 * One `RiskArea` row (any of the four `RiskAreaLevel`s) — the
 * `RiskAreaList`/`areas.json` sibling of `RiskProvinceRow`
 * (`districts.json`), same visual language (band tag, relative bar,
 * P05-P95 whisker, "partly inside map" tag) but reading from `RiskArea`'s
 * `id`/`name` fields instead of `RiskDistrict`'s `adm1Id`/`adm1Name`, and
 * tolerating a `null` P05-P95 triple (the `n_draws: 0` case — no whisker
 * drawn at all when there is no range to show, never a fabricated
 * zero-width one).
 */
export function RiskAreaRow({
  area,
  worstBuildingsHeavy,
  locale,
  t,
  colors,
  typography,
  spacing,
}: RiskAreaRowProps) {
  const band = classifyDamageBand(area.buildingsHeavy);
  const triple = area.buildingsHeavyP05P50P95;
  const barWidth = relativeWidthPercent(area.buildingsHeavy, worstBuildingsHeavy);
  const isPartlyInsideMap = area.coverage < LOW_COVERAGE_THRESHOLD;

  // The producer corrects the boundary file's Arabic transliterations and
  // ships the Kurdish forms with them, so a Sorani reader sees سلێمانی
  // rather than "Slemani", and neither sees "Al-Sulaymaniyah".
  const displayName = area.names?.[locale] ?? area.name;
  const captionValue = formatApproximate(area.buildingsHeavy, locale, t);
  const a11yLabel = t("eventDetail.risk.areaRowA11y", {
    area: displayName,
    band: t(`eventDetail.risk.band.${band}.title`),
    value: captionValue,
  });

  let whiskerLeft: `${number}%` | null = null;
  let whiskerWidth: `${number}%` | null = null;
  if (triple) {
    const [p05, , p95] = triple;
    const whiskerStartFraction = relativeFraction(p05, worstBuildingsHeavy);
    const whiskerEndFraction = relativeFraction(p95, worstBuildingsHeavy);
    whiskerLeft = `${(whiskerStartFraction * 100).toFixed(2)}%` as `${number}%`;
    whiskerWidth = `${(Math.max(0, whiskerEndFraction - whiskerStartFraction) * 100).toFixed(2)}%` as `${number}%`;
  }

  return (
    <View
      testID="risk-area-row"
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
          {displayName}
        </Text>
        <View style={[styles.tagsRow, { gap: spacing[1] }]}>
          {isPartlyInsideMap ? (
            <View
              testID="risk-area-row-coverage-tag"
              style={[styles.tag, { backgroundColor: colors.surface.sunken }]}
            >
              <Text style={{ color: colors.text.tertiary, fontSize: 10, fontWeight: "600" }}>
                {t("eventDetail.risk.partlyInsideMap")}
              </Text>
            </View>
          ) : null}
          <View
            testID="risk-area-row-band-tag"
            style={[styles.tag, { backgroundColor: damageBandColor(band, colors) }]}
          >
            <Text style={{ color: colors.text.inverse, fontSize: 10, fontWeight: "700" }}>
              {t(`eventDetail.risk.band.${band}.title`)}
            </Text>
          </View>
        </View>
      </View>

      {/* Same non-mirroring rule as `RiskProvinceRow` — the relative-length
       * bar always reads left to right regardless of locale. */}
      <View style={[styles.barTrack, { direction: "ltr" }]}>
        {whiskerLeft !== null && whiskerWidth !== null ? (
          <View
            testID="risk-area-row-whisker"
            style={[
              styles.whisker,
              { left: whiskerLeft, width: whiskerWidth, backgroundColor: colors.surface.overlay },
            ]}
          />
        ) : null}
        <View
          testID="risk-area-row-bar"
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
