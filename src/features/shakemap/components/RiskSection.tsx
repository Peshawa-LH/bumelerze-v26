import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { TextStyle } from "react-native";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

import type { Event } from "@/features/events";
import { formatIntegerLocalized, localizeDigits } from "@/lib/format-numbers";
import { useTheme, type Theme } from "@/theme";
import { useResolvedShakeMap } from "../live-queries";
import type { ReviewStatus, RiskDistrict, RiskProduct } from "../types";

export interface RiskSectionProps {
  event: Event;
}

interface RiskSectionContentProps {
  /** `null` for the overwhelming majority of events (no risk product
   * computed yet) — renders nothing at all, same "no empty shell" rule
   * `ShakeMapSection`/`FeltMapSection` already follow for their own
   * absent cases. */
  risk: RiskProduct | null;
  /** Reused from the resolved SHAKEmap product's own `reviewStatus`
   * (the same `useResolvedShakeMap` call `ShakeMapSection` makes) rather
   * than duplicating a second review-status concept — the risk chain is
   * computed from the same hazard version and carries no independent
   * review state of its own yet. Reuses
   * `eventDetail.shakemap.reviewStatus.*`, the exact copy `ShakeMapSection`
   * already shows for the intensity map, so the two provenance lines never
   * drift or contradict each other. */
  reviewStatus: ReviewStatus;
}

/** First page of the district table before "Show all" is tapped — enough
 * to show the worst-hit handful without a wall of rows on first render
 * (wave brief: "first 8 rows with a Show all (30) toggle"). */
const INITIAL_DISTRICT_ROWS = 8;

interface RowStyles {
  colors: Theme["colors"];
  typography: Theme["typography"];
  locale: string;
  t: TFunction;
}

/** One district-table row — province name, heavy-building range, exposed
 * population. Plain `flexDirection: "row"` cells (no absolute left/right),
 * so this mirrors correctly under RTL without any locale-specific
 * styling; the row's own `accessibilityLabel` spells the same three
 * numbers out as one sentence for a screen-reader user, since the visual
 * layout alone (three terse columns) carries much of its meaning through
 * position. */
function DistrictRow({ district, colors, typography, locale, t }: RowStyles & { district: RiskDistrict }) {
  const [p05, p50, p95] = district.buildingsHeavyP05P50P95;
  const rangeText = t("eventDetail.risk.rangeText", {
    p50: formatIntegerLocalized(p50, locale),
    p05: formatIntegerLocalized(p05, locale),
    p95: formatIntegerLocalized(p95, locale),
  });
  const populationText = formatIntegerLocalized(district.exposedPopulation, locale);
  const a11yLabel = t("eventDetail.risk.districtRowA11y", {
    district: district.adm1Name,
    heavy: formatIntegerLocalized(p50, locale),
    p05: formatIntegerLocalized(p05, locale),
    p95: formatIntegerLocalized(p95, locale),
    population: populationText,
  });

  const valueTextStyle: TextStyle = {
    color: colors.text.primary,
    fontSize: typography.bodyMeta.fontSize,
    lineHeight: typography.bodyMeta.lineHeight,
    fontVariant: ["tabular-nums"],
    writingDirection: "ltr",
  };

  return (
    <View
      style={styles.districtRow}
      accessible
      accessibilityLabel={a11yLabel}
    >
      <Text
        style={[
          styles.districtNameCell,
          {
            color: colors.text.primary,
            fontSize: typography.bodyMeta.fontSize,
            lineHeight: typography.bodyMeta.lineHeight,
          },
        ]}
        numberOfLines={1}
      >
        {district.adm1Name}
      </Text>
      <Text style={[valueTextStyle, styles.districtRangeCell]} numberOfLines={1}>
        {rangeText}
      </Text>
      <Text style={[valueTextStyle, styles.districtPopulationCell]} numberOfLines={1}>
        {populationText}
      </Text>
    </View>
  );
}

/**
 * Event Detail's damage-estimate dashboard (D46 risk chain, `risk-
 * dashboard` wave) — mounted directly after `ShakeMapSection`
 * (`app/event/[id].tsx`). Renders nothing at all when the resolved
 * SHAKEmap product has no risk data (three events carry it at launch:
 * us6000jllz, us6000jlqa, us2000bmcg; every other event resolves to
 * `risk: null` and this section is simply absent — same "no empty shell"
 * convention every other conditional Event Detail section already
 * follows).
 *
 * Deliberately never reads or renders any fatality/injury number (D45:
 * "casualty estimates are computed but not published") — `RiskProduct`
 * itself has no field for one (`risk.ts`'s own doc comment), so there is
 * nothing here that even COULD leak one; the closing provenance line
 * says so explicitly instead of just staying silent about it.
 */
function RiskSectionContent({ risk, reviewStatus }: RiskSectionContentProps) {
  const { t, i18n } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const [showAllDistricts, setShowAllDistricts] = useState(false);

  if (!risk) {
    return null;
  }

  const locale = i18n.language;
  const { summary, districts } = risk;

  const titleStyle = {
    color: colors.text.secondary,
    fontSize: typography.labelCaption.fontSize,
    lineHeight: typography.labelCaption.lineHeight,
    fontWeight: typography.labelCaption.fontWeight,
  } as const;
  // Panic-time-readable headline (wave brief: "big enough type") — same
  // `h3` tier `app/event/[id].tsx` already uses for its own prominent
  // secondary text (the place-name line under the magnitude hero number).
  const headlineStyle = {
    color: colors.text.primary,
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    fontWeight: typography.h3.fontWeight,
  } as const;
  const bodyStyle = {
    color: colors.text.secondary,
    fontSize: typography.bodyMeta.fontSize,
    lineHeight: typography.bodyMeta.lineHeight,
  } as const;
  const tableHeaderStyle = {
    color: colors.text.tertiary,
    fontSize: typography.labelCaption.fontSize,
    lineHeight: typography.labelCaption.lineHeight,
    fontWeight: typography.labelCaption.fontWeight,
  } as const;

  const [p05, p50, p95] = summary.buildingsHeavyP05P50P95;
  const headline = t("eventDetail.risk.headline", {
    p50: formatIntegerLocalized(p50, locale),
    p05: formatIntegerLocalized(p05, locale),
    p95: formatIntegerLocalized(p95, locale),
  });
  const exposedPopulationText = t("eventDetail.risk.exposedPopulation", {
    count: formatIntegerLocalized(summary.exposedPopulation, locale),
  });

  const visibleDistricts = showAllDistricts
    ? districts.districts
    : districts.districts.slice(0, INITIAL_DISTRICT_ROWS);
  const hasMoreDistricts = districts.districts.length > INITIAL_DISTRICT_ROWS;

  return (
    <View style={{ gap: spacing[2] }}>
      <Text style={titleStyle}>{t("eventDetail.risk.sectionTitle")}</Text>
      <Text style={headlineStyle}>{headline}</Text>
      <Text style={bodyStyle}>{exposedPopulationText}</Text>

      {districts.districts.length > 0 ? (
        <View style={{ gap: spacing[1] }}>
          <View style={styles.districtRow}>
            <Text style={[tableHeaderStyle, styles.districtNameCell]}>
              {t("eventDetail.risk.table.district")}
            </Text>
            <Text style={[tableHeaderStyle, styles.districtRangeCell]}>
              {t("eventDetail.risk.table.heavyBuildings")}
            </Text>
            <Text style={[tableHeaderStyle, styles.districtPopulationCell]}>
              {t("eventDetail.risk.table.population")}
            </Text>
          </View>
          {visibleDistricts.map((district) => (
            <DistrictRow
              key={district.adm1Id}
              district={district}
              colors={colors}
              typography={typography}
              locale={locale}
              t={t}
            />
          ))}
          {hasMoreDistricts ? (
            <Pressable
              testID="risk-districts-show-all"
              accessibilityRole="button"
              onPress={() => setShowAllDistricts((prev) => !prev)}
              hitSlop={12}
            >
              <Text
                style={{
                  color: colors.text.link,
                  fontSize: typography.bodyMeta.fontSize,
                  fontWeight: "600",
                }}
              >
                {showAllDistricts
                  ? t("eventDetail.risk.showFewer")
                  : t("eventDetail.risk.showAll", {
                      count: localizeDigits(String(districts.districts.length), locale),
                    })}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {/* Provenance block — same "always visible, never hidden as fine
       * print" treatment `ShakeMapSection` gives its own provenance lines. */}
      <View style={{ gap: spacing[1] }}>
        <Text style={bodyStyle}>
          {t("eventDetail.risk.provenance.stage", { stage: summary.stage })}
        </Text>
        <Text style={bodyStyle}>
          {t("eventDetail.risk.provenance.draws", {
            count: localizeDigits(String(summary.nDraws), locale),
          })}
        </Text>
        <Text style={bodyStyle}>
          {t(`eventDetail.risk.provenance.timeOfDay.${summary.timeOfDay}`)}
        </Text>
        <Text style={bodyStyle}>{t(`eventDetail.shakemap.reviewStatus.${reviewStatus}`)}</Text>
        <Text style={bodyStyle}>{t("eventDetail.risk.casualtiesNote")}</Text>
      </View>
    </View>
  );
}

/**
 * Public entry point — mounted unconditionally by the screen right after
 * `<ShakeMapSection event={event} />` (`app/event/[id].tsx`), same
 * `{ event }`-only prop shape as `ShakeMapSection`/`FeltMapSection`. Calls
 * `useResolvedShakeMap` a second time rather than threading the already-
 * resolved product down from the screen — React Query dedupes this
 * against `ShakeMapSection`'s own call (same query key, same cache entry,
 * `live-queries.ts`'s `liveShakeMapQueryKeys`), so this costs nothing
 * extra over the network; it keeps each Event Detail section fully
 * self-contained, matching the rest of this screen's architecture.
 */
export function RiskSection({ event }: RiskSectionProps) {
  const shakeMap = useResolvedShakeMap(event, true);

  if (shakeMap.status === "absent" || !shakeMap.product) {
    return null;
  }

  return <RiskSectionContent risk={shakeMap.risk} reviewStatus={shakeMap.product.reviewStatus} />;
}

const styles = StyleSheet.create({
  districtRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  districtNameCell: {
    flex: 3,
  },
  // No hardcoded `textAlign: "left"/"right"` — a flex row already mirrors
  // start-to-end correctly under `I18nManager` RTL on its own (design-
  // language.md: logical flex, not physical left/right), and the numeric
  // cells force `writingDirection: "ltr"` (numerals themselves, unlike
  // prose, always read left-to-right in this app — `lib/format-numbers.ts`
  // ), so their own natural start-alignment already reads correctly in
  // every locale.
  districtRangeCell: {
    flex: 3,
  },
  districtPopulationCell: {
    flex: 2,
  },
});
