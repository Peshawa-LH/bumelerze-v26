import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { DonutChart, type DonutSlice } from "@/components/DonutChart";
import type { Event } from "@/features/events";
import { isolateNumeric } from "@/features/events";
import {
  buildDamageSegments,
  damagePercentText,
  INTENSITY_ROMAN_NUMERALS,
  LOWEST_DEGREE_SHOWN,
  useResolvedShakeMap,
} from "@/features/shakemap";
import { formatApproximate, formatIntegerLocalized } from "@/lib/format-numbers";
import { useTheme } from "@/theme";

import type { HubSummary } from "../types";

interface HubImpactSectionProps {
  event: Event;
  /** Null while unknown (loading or unavailable). */
  summary: HubSummary | null;
}

/**
 * "Impact at a glance": up to three small donuts side by side (they wrap on
 * a narrow screen) — what people felt (felt reports), estimated building
 * damage and people by shaking level (both from the SHAKEmap and damage
 * estimate). Each chart appears only when it has data, and the whole section
 * renders nothing when none does. Aggregates and shares only; there is no
 * casualty figure anywhere (D45), because none is ever parsed.
 *
 * The damage donut reuses the stacked bar's own grouping and rounding
 * (`buildDamageSegments`), and the people donut its colours and the level IV
 * floor, so the hub can never disagree with the event page.
 */
export function HubImpactSection({ event, summary }: HubImpactSectionProps) {
  const { t, i18n } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const locale = i18n.language;
  const shakeMap = useResolvedShakeMap(event, true);

  // Felt reports by cartoon level, in level order.
  const feltCounts = Object.entries(summary?.levels ?? {})
    .map(([level, count]) => ({ level: Number(level), count }))
    .filter((row) => row.count > 0)
    .sort((a, b) => a.level - b.level);
  const feltTotal = feltCounts.reduce((sum, row) => sum + row.count, 0);
  const feltSlices: DonutSlice[] = feltCounts.map(({ level, count }) => ({
    key: `level-${level}`,
    value: count,
    color: colors.intensity[level] ?? colors.surface.sunken,
    label: t(`felt.tier1.levels.${level}.label`),
  }));

  const riskSummary = shakeMap.status === "ready" && shakeMap.risk ? shakeMap.risk.summary : null;

  // Building damage: only when the product carries the DG0..DG5 split.
  const grades =
    riskSummary?.buildingsByGrade && riskSummary.buildingsByGrade.length === 6
      ? riskSummary.buildingsByGrade
      : null;
  const damageSegments =
    riskSummary && grades
      ? buildDamageSegments({
          buildingsInGrid: riskSummary.exposure.buildingsInGrid,
          buildingsHeavy: riskSummary.buildingsHeavy,
          buildingsDg4Plus: (grades[4] ?? 0) + (grades[5] ?? 0),
          buildingsByGrade: grades,
          colors,
        })
      : null;
  const damageSlices: DonutSlice[] = (damageSegments ?? []).map((segment) => ({
    key: segment.key,
    // A band with buildings in it that rounds to 0 still gets a sliver.
    value: segment.underOnePercent ? 0.5 : segment.percent,
    color: segment.color,
    label: t(`eventDetail.risk.stackedBar.${segment.key}`),
    valueText: t("donut.percent", { value: damagePercentText(segment, locale, t) }),
  }));

  // People by shaking level, strongest first, same floor as the event page.
  const peopleRows = Object.entries(riskSummary?.populationByIntensity ?? {})
    .map(([degree, people]) => ({ degree: Number(degree), people }))
    .filter((row) => row.degree >= LOWEST_DEGREE_SHOWN && row.people > 0)
    .sort((a, b) => b.degree - a.degree);
  const peopleTotal = peopleRows.reduce((sum, row) => sum + row.people, 0);
  const peopleSlices: DonutSlice[] = peopleRows.map(({ degree, people }) => ({
    key: `degree-${degree}`,
    value: people,
    color: colors.intensity[degree] ?? colors.status.warning,
    label: t("eventHub.impact.level", {
      level: INTENSITY_ROMAN_NUMERALS[degree] ?? String(degree),
    }),
  }));

  const showFelt = feltSlices.length > 0;
  const showDamage = damageSlices.length > 0 && riskSummary !== null;
  const showPeople = peopleSlices.length > 0;
  if (!showFelt && !showDamage && !showPeople) {
    return null;
  }
  const showNote = showDamage || showPeople;
  const reviewed = shakeMap.product?.reviewStatus === "reviewed";

  const titleStyle = {
    color: colors.text.primary,
    fontSize: typography.bodyMeta.fontSize,
    lineHeight: typography.bodyMeta.lineHeight,
    fontWeight: "600",
    textAlign: "center",
  } as const;
  const captionStyle = {
    color: colors.text.secondary,
    fontSize: typography.labelCaption.fontSize,
    lineHeight: typography.labelCaption.lineHeight,
    textAlign: "center",
  } as const;

  return (
    <View
      testID="hub-impact"
      style={[
        styles.card,
        {
          backgroundColor: colors.surface.raised,
          borderColor: colors.border.default,
          padding: spacing[4],
          gap: spacing[4],
        },
      ]}
    >
      <Text
        accessibilityRole="header"
        style={{
          color: colors.text.primary,
          fontSize: typography.h3.fontSize,
          lineHeight: typography.h3.lineHeight,
          fontWeight: typography.h3.fontWeight,
        }}
      >
        {t("eventHub.impact.title")}
      </Text>

      <View style={[styles.charts, { gap: spacing[5] }]}>
        {showFelt ? (
          <View style={[styles.chart, { gap: spacing[2] }]} testID="hub-impact-felt">
            <Text style={titleStyle}>{t("eventHub.impact.felt.title")}</Text>
            <DonutChart
              slices={feltSlices}
              title={t("eventHub.impact.felt.title")}
              centerText={isolateNumeric(formatIntegerLocalized(feltTotal, locale))}
            />
            <Text style={captionStyle}>{t("eventHub.impact.felt.caption")}</Text>
          </View>
        ) : null}

        {showDamage && riskSummary ? (
          <View style={[styles.chart, { gap: spacing[2] }]} testID="hub-impact-damage">
            <Text style={titleStyle}>{t("eventHub.impact.damage.title")}</Text>
            <DonutChart
              slices={damageSlices}
              title={t("eventHub.impact.damage.title")}
              centerText={isolateNumeric(
                formatApproximate(riskSummary.exposure.buildingsInGrid, locale, t),
              )}
            />
            <Text style={captionStyle}>{t("eventHub.impact.damage.caption")}</Text>
          </View>
        ) : null}

        {showPeople ? (
          <View style={[styles.chart, { gap: spacing[2] }]} testID="hub-impact-people">
            <Text style={titleStyle}>{t("eventHub.impact.people.title")}</Text>
            <DonutChart
              slices={peopleSlices}
              title={t("eventHub.impact.people.title")}
              centerText={isolateNumeric(formatApproximate(peopleTotal, locale, t))}
            />
            <Text style={captionStyle}>{t("eventHub.impact.people.caption")}</Text>
          </View>
        ) : null}
      </View>

      {showNote ? (
        <Text
          testID="hub-impact-note"
          style={{
            color: colors.text.tertiary,
            fontSize: typography.labelCaption.fontSize,
            lineHeight: typography.labelCaption.lineHeight,
          }}
        >
          {reviewed ? t("eventHub.impact.noteReviewed") : t("eventHub.impact.note")}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 12,
  },
  charts: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
  },
  // Two across on a phone, three on a tablet; each takes its share of a row.
  chart: {
    flexGrow: 1,
    flexBasis: 140,
    minWidth: 140,
    maxWidth: 220,
    alignItems: "stretch",
  },
});
