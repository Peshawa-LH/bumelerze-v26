import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import type { Event } from "@/features/events";
import { useTheme } from "@/theme";
import { useResolvedShakeMap } from "../live-queries";
import { classifyDamageBand } from "../risk-alert";
import { RiskAreaList } from "./RiskAreaList";
import { RiskBuildingTypes } from "./RiskBuildingTypes";
import { RiskDamageBandTag } from "./RiskDamageBandTag";
import { RiskDamageGradeBar } from "./RiskDamageGradeBar";
import { RiskExposureTiles } from "./RiskExposureTiles";
import { RiskImpactScale } from "./RiskImpactScale";
import { RiskProvenanceChips } from "./RiskProvenanceChips";
import { RiskProvinceList } from "./RiskProvinceList";
import { RiskShakingLevels } from "./RiskShakingLevels";

export interface RiskSectionProps {
  event: Event;
}

/**
 * Event Detail's damage-estimate dashboard (D46 risk chain) — a VISUAL
 * dashboard, not the numeric table this section used to be (owner: "it
 * shouldn't be just a table with numbers... people understand visuals,
 * not direct numbers; direct numbers are in the Atlas for engineers").
 * Content, top to bottom: the damage alert band
 * (`RiskDamageBandTag`), the impact scale (`RiskImpactScale`), the two
 * exposure tiles (`RiskExposureTiles`), the damage-grade stacked bar
 * (`RiskDamageGradeBar`), the ranked area list — `RiskAreaList` (the
 * four-level, switchable `areas.json` product, `risk-areas` wave) when the
 * resolved risk product carries one, else the older single-level
 * `RiskProvinceList` (`districts.json`) so a bundled/older event with no
 * `areas` product still shows something — and the provenance chip strip +
 * report download (`RiskProvenanceChips`).
 *
 * Visually drawn in Bumelerze's own language (rounded theme-token cards,
 * chips, gradient rail — never PAGER's colored-banner/histogram look; see
 * each sub-component's own doc comment for the specific redraw). Never
 * reads or renders any fatality/injury figure (D45) — `RiskProduct` has no
 * field for one at all, so there is nothing here that even COULD leak one.
 *
 * Renders nothing at all when the resolved SHAKEmap product has no risk
 * data (the common case — only 3 events carry one at launch), same "no
 * empty shell" convention every other conditional Event Detail section
 * follows.
 */
export function RiskSection({ event }: RiskSectionProps) {
  const [detailOpen, setDetailOpen] = useState(false);
  const { t, i18n } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const shakeMap = useResolvedShakeMap(event, true);

  if (shakeMap.status === "absent" || !shakeMap.product || !shakeMap.risk) {
    return null;
  }

  const { risk, product } = shakeMap;
  const { summary, districts, areas, reportUrl } = risk;
  const locale = i18n.language;
  const [p05, p50, p95] = summary.buildingsHeavyP05P50P95;
  const band = classifyDamageBand(p50);

  const titleStyle = {
    color: colors.text.secondary,
    fontSize: typography.labelCaption.fontSize,
    lineHeight: typography.labelCaption.lineHeight,
    fontWeight: typography.labelCaption.fontWeight,
  } as const;

  return (
    <View style={{ gap: spacing[4] }}>
      <Text style={titleStyle}>{t("eventDetail.risk.sectionTitle")}</Text>

      <RiskDamageBandTag band={band} t={t} colors={colors} typography={typography} spacing={spacing} />

      {summary.populationByIntensity ? (
        <RiskShakingLevels
          populationByIntensity={summary.populationByIntensity}
          locale={locale}
          t={t}
          colors={colors}
          typography={typography}
          spacing={spacing}
        />
      ) : null}

      <RiskExposureTiles
        // The people tile counted everyone inside the map window, which
        // for a large event is most of the country. Where the product can
        // break that down by shaking level (schema 2), the block above
        // says it properly and the tile would only contradict it.
        exposedPopulation={summary.populationByIntensity ? null : summary.exposedPopulation}
        buildingsInGrid={summary.exposure.buildingsInGrid}
        locale={locale}
        t={t}
        colors={colors}
        typography={typography}
        spacing={spacing}
      />

      <RiskDamageGradeBar
        buildingsInGrid={summary.exposure.buildingsInGrid}
        buildingsHeavy={summary.buildingsHeavy}
        buildingsByGrade={summary.buildingsByGrade}
        buildingsDg4Plus={
          // Schema 2 carries the whole DG0..DG5 split nationally, so DG4+
          // is read straight off it. Before schema 2 the national summary
          // had no DG4+ figure of its own and this summed the district
          // rows instead, which is only right when those rows cover the
          // same event and the same grid.
          summary.buildingsByGrade && summary.buildingsByGrade.length === 6
            ? (summary.buildingsByGrade[4] ?? 0) + (summary.buildingsByGrade[5] ?? 0)
            : districts.districts.length > 0
              ? districts.districts.reduce((sum, district) => sum + district.buildingsDg4Plus, 0)
              : summary.buildingsHeavy
        }
        locale={locale}
        t={t}
        colors={colors}
        typography={typography}
        spacing={spacing}
      />

      <Pressable
        onPress={() => setDetailOpen((open) => !open)}
        accessibilityRole="button"
        testID="risk-detail-toggle"
      >
        <Text style={{ ...titleStyle, color: colors.text.link }}>
          {detailOpen
            ? t("eventDetail.risk.detail.hide")
            : t("eventDetail.risk.detail.show")}
        </Text>
      </Pressable>

      {detailOpen ? (
        <View style={{ gap: spacing[4] }}>
          {/* The range lives here rather than at the top (Peshawa,
              2026-09-21). Heavy damage on the 2017 event spans roughly
              20,000 to 290,000 buildings, a factor of fifteen, so a
              headline number implies a precision the model does not have.
              The band word leads; the numbers are one tap away. */}
          <RiskImpactScale
            p05={p05}
            p50={p50}
            p95={p95}
            locale={locale}
            t={t}
            colors={colors}
            typography={typography}
            spacing={spacing}
          />

          {summary.buildingsByType && summary.typeCatalog ? (
            <RiskBuildingTypes
              types={summary.buildingsByType}
              catalog={summary.typeCatalog}
              locale={locale}
              t={t}
              colors={colors}
              typography={typography}
              spacing={spacing}
            />
          ) : null}
        </View>
      ) : null}

      {areas ? (
        <RiskAreaList
          areas={areas}
          locale={locale}
          t={t}
          colors={colors}
          typography={typography}
          spacing={spacing}
        />
      ) : (
        <RiskProvinceList
          districts={districts.districts}
          locale={locale}
          t={t}
          colors={colors}
          typography={typography}
          spacing={spacing}
        />
      )}

      <RiskProvenanceChips
        stage={summary.stage}
        timeOfDay={summary.timeOfDay}
        nDraws={summary.nDraws}
        reviewStatus={product.reviewStatus}
        reportUrl={reportUrl}
        locale={locale}
        t={t}
        colors={colors}
        typography={typography}
        spacing={spacing}
      />
    </View>
  );
}
