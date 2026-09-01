import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import type { Event } from "@/features/events";
import { useTheme } from "@/theme";
import { useResolvedShakeMap } from "../live-queries";
import { classifyDamageBand } from "../risk-alert";
import { RiskDamageBandTag } from "./RiskDamageBandTag";
import { RiskDamageGradeBar } from "./RiskDamageGradeBar";
import { RiskExposureTiles } from "./RiskExposureTiles";
import { RiskImpactScale } from "./RiskImpactScale";
import { RiskProvenanceChips } from "./RiskProvenanceChips";
import { RiskProvinceList } from "./RiskProvinceList";

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
 * (`RiskDamageGradeBar`), the ranked province list (`RiskProvinceList`),
 * and the provenance chip strip + report download (`RiskProvenanceChips`).
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
  const { t, i18n } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const shakeMap = useResolvedShakeMap(event, true);

  if (shakeMap.status === "absent" || !shakeMap.product || !shakeMap.risk) {
    return null;
  }

  const { risk, product } = shakeMap;
  const { summary, districts, reportUrl } = risk;
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

      <RiskExposureTiles
        exposedPopulation={summary.exposedPopulation}
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
        buildingsDg4Plus={
          // The national total doesn't carry its own dg4plus figure
          // (`RiskSummary` deliberately narrower than the source product —
          // `types.ts`'s own doc comment); the district rows do, so the
          // stacked bar sums them instead. Falls back to `buildingsHeavy`
          // (treating every heavy building as DG3, the conservative
          // under-estimate for the "very heavy" slice) when there are no
          // district rows to sum at all.
          districts.districts.length > 0
            ? districts.districts.reduce((sum, district) => sum + district.buildingsDg4Plus, 0)
            : summary.buildingsHeavy
        }
        locale={locale}
        t={t}
        colors={colors}
        typography={typography}
        spacing={spacing}
      />

      <RiskProvinceList
        districts={districts.districts}
        locale={locale}
        t={t}
        colors={colors}
        typography={typography}
        spacing={spacing}
      />

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
