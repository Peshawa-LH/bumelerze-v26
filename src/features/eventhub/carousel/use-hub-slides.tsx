import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import type { DonutSlice } from "@/components/DonutChart";
import type { Event } from "@/features/events";
import {
  buildDamageSegments,
  damagePercentText,
} from "@/features/shakemap/components/RiskDamageGradeBar";
import { LOWEST_DEGREE_SHOWN } from "@/features/shakemap/components/RiskShakingLevels";
import { formatIntensity } from "@/features/shakemap/intensity-format";
import { useResolvedShakeMap } from "@/features/shakemap/live-queries";
import { useShareCardModel } from "@/features/share/use-card-model";
import { useFeltTimeline, useFeltTowns } from "@/features/social/queries";
import type { SocialTransport } from "@/features/social/transport";
import { useTheme } from "@/theme";

import type { HubSummary } from "../types";
import type { CarouselSlide } from "./HubCarousel";
import { buildClassDamage } from "./slide-data";
import {
  ClassDamageSlide,
  FeltTownsSlide,
  ImpactSlide,
  ShareImageSlide,
  TimelineSlide,
} from "./slides";

/**
 * The slides of one Event hub, in the owner's fixed order, each only when it
 * has data (review note 4.3, 2026-10-14):
 *   1. the square share image (always)
 *   2. Impact at a glance (a damage or people-by-shaking estimate exists)
 *   3. Felt shaking by town (the event has felt reports)
 *   4. Reports over time (recent events only: not a featured "memory" hub,
 *      and at least one report in the first 24 hours)
 *   5. Damage by building class (a Bumelerze damage run with per-type grades)
 * No slide is ever an empty placeholder.
 */
export function useHubSlides({
  event,
  shareId,
  eventUuid,
  summary,
  transport,
}: {
  event: Event;
  shareId: string;
  eventUuid: string | null;
  summary: HubSummary | null;
  transport?: SocialTransport;
}): CarouselSlide[] {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const locale = i18n.language;
  const buildModel = useShareCardModel(event, shareId);
  const shakeMap = useResolvedShakeMap(event, true);
  const hasReports = (summary?.reports ?? 0) > 0;
  const featured = summary?.featured === true;
  const { towns } = useFeltTowns(eventUuid, hasReports, transport);
  const { timeline } = useFeltTimeline(eventUuid, hasReports && !featured, transport);

  const riskSummary =
    shakeMap.status === "ready" && shakeMap.risk ? shakeMap.risk.summary : null;
  const reviewed = shakeMap.product?.reviewStatus === "reviewed";

  return useMemo(() => {
    const slides: CarouselSlide[] = [
      {
        key: "share",
        title: t("eventHub.slides.share"),
        render: (size) => <ShareImageSlide size={size} model={buildModel("square")} />,
      },
    ];

    // 2. Impact at a glance: the event page's own grouping and rounding.
    const grades =
      riskSummary?.buildingsByGrade && riskSummary.buildingsByGrade.length === 6
        ? riskSummary.buildingsByGrade
        : null;
    const segments =
      riskSummary && grades
        ? buildDamageSegments({
            buildingsInGrid: riskSummary.exposure.buildingsInGrid,
            buildingsHeavy: riskSummary.buildingsHeavy,
            buildingsDg4Plus: (grades[4] ?? 0) + (grades[5] ?? 0),
            buildingsByGrade: grades,
            colors,
          })
        : null;
    const damageSlices: DonutSlice[] = (segments ?? []).map((segment) => ({
      key: segment.key,
      value: segment.underOnePercent ? 0.5 : segment.percent,
      color: segment.color,
      label: t(`eventDetail.risk.stackedBar.${segment.key}`),
      valueText: t("donut.percent", { value: damagePercentText(segment, locale, t) }),
    }));
    const peopleRows = Object.entries(riskSummary?.populationByIntensity ?? {})
      .map(([degree, people]) => ({ degree: Number(degree), people }))
      .filter((row) => row.degree >= LOWEST_DEGREE_SHOWN && row.people > 0)
      .sort((a, b) => b.degree - a.degree);
    const peopleSlices: DonutSlice[] = peopleRows.map(({ degree, people }) => ({
      key: `degree-${degree}`,
      value: people,
      color: colors.intensity[degree] ?? colors.status.warning,
      label: t("eventHub.impact.level", { level: formatIntensity(degree, locale) }),
    }));
    const damage =
      riskSummary && damageSlices.length > 0
        ? { slices: damageSlices, total: riskSummary.exposure.buildingsInGrid }
        : null;
    const people =
      peopleSlices.length > 0
        ? {
            slices: peopleSlices,
            total: peopleRows.reduce((sum, row) => sum + row.people, 0),
            floorLevel: LOWEST_DEGREE_SHOWN,
          }
        : null;
    if (damage || people) {
      slides.push({
        key: "impact",
        title: t("eventHub.impact.title"),
        render: (size) => (
          <ImpactSlide size={size} damage={damage} people={people} reviewed={reviewed} />
        ),
      });
    }

    // 3. Felt shaking by town.
    if (hasReports && towns.length > 0) {
      slides.push({
        key: "towns",
        title: t("eventHub.slides.towns.title"),
        render: (size) => <FeltTownsSlide size={size} towns={towns} />,
      });
    }

    // 4. Reports over time: recent events only.
    if (!featured && timeline && timeline.firstDay > 0) {
      slides.push({
        key: "timeline",
        title: t("eventHub.slides.timeline.title"),
        render: (size) => <TimelineSlide size={size} timeline={timeline} />,
      });
    }

    // 5. Damage by building class.
    const classes = buildClassDamage(riskSummary);
    if (classes.length > 0) {
      slides.push({
        key: "classes",
        title: t("eventHub.slides.classes.title"),
        render: (size) => (
          <ClassDamageSlide size={size} rows={classes} reviewed={reviewed} />
        ),
      });
    }
    return slides;
  }, [
    t,
    locale,
    colors,
    buildModel,
    riskSummary,
    reviewed,
    hasReports,
    towns,
    featured,
    timeline,
  ]);
}
