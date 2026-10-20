import type { TFunction } from "i18next";
import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import Svg, { Line, Polyline, Rect } from "react-native-svg";

import { DonutChart, type DonutSlice } from "@/components/DonutChart";
import { isolateNumeric } from "@/features/events/format";
import { GAZETTEER_CITIES, pickLocalizedName } from "@/features/geo/gazetteer";
import { ShareCardSvg } from "@/features/share/ShareCardSvg";
import type { CardModel } from "@/features/share/card-layout";
import type { FeltTimeline, FeltTown } from "@/features/social/transport";
import { formatIntensity } from "@/features/shakemap/intensity-format";
import { isRTLLocale } from "@/i18n";
import { approximateParts, localizeDigits } from "@/lib/format-numbers";
import { useTheme, nativeFontFamily } from "@/theme";
import { percentValue, runningTotal, type ClassDamageRow } from "./slide-data";

/** The frame every chart slide shares: a raised square card, a title, a
 * one-line subtitle, the chart, and a small source note at the bottom. */
function SlideFrame({
  size,
  title,
  subtitle,
  note,
  children,
  testID,
}: {
  size: number;
  title: string;
  subtitle?: string;
  note?: string;
  children: ReactNode;
  testID: string;
}) {
  const { colors, typography, spacing } = useTheme();
  return (
    <View
      testID={testID}
      style={[
        styles.frame,
        {
          width: size,
          height: size,
          backgroundColor: colors.surface.raised,
          borderColor: colors.border.default,
          padding: spacing[4],
          gap: spacing[2],
        },
      ]}
    >
      <View style={{ paddingEnd: 44 }}>
        <Text
          accessibilityRole="header"
          style={[typography.labelButton, { color: colors.text.primary }]}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text style={[typography.labelCaption, { color: colors.text.secondary }]}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <View style={styles.body}>{children}</View>
      {note ? (
        <Text
          style={[typography.labelCaption, { color: colors.text.tertiary }]}
          numberOfLines={2}
        >
          {note}
        </Text>
      ) : null}
    </View>
  );
}

/** Slide 1: the square share image, exactly as the share sheet makes it. */
export function ShareImageSlide({ size, model }: { size: number; model: CardModel }) {
  return (
    <View
      testID="slide-share-image"
      // The card positions its text itself; its box keeps its own direction.
      style={{ width: size, height: size, direction: "ltr" }}
    >
      <ShareCardSvg model={model} displayWidth={size} />
    </View>
  );
}

/** Slide 2: "Impact at a glance", the damage and people donuts. */
export function ImpactSlide({
  size,
  damage,
  people,
  reviewed,
}: {
  size: number;
  damage: { slices: DonutSlice[]; total: number } | null;
  people: { slices: DonutSlice[]; total: number; floorLevel: number } | null;
  reviewed: boolean;
}) {
  const { t, i18n } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const locale = i18n.language;
  const donut = Math.max(76, Math.min(110, Math.floor((size - 72) / 2.6)));
  const caption = {
    color: colors.text.secondary,
    fontSize: typography.labelCaption.fontSize,
    fontFamily: nativeFontFamily(typography.labelCaption, "400"),
    lineHeight: typography.labelCaption.lineHeight,
    textAlign: "center",
  } as const;
  return (
    <SlideFrame
      size={size}
      title={t("eventHub.impact.title")}
      note={reviewed ? t("eventHub.impact.noteReviewed") : t("eventHub.impact.note")}
      testID="slide-impact"
    >
      <View style={[styles.donuts, { gap: spacing[3] }]}>
        {damage ? (
          <View style={[styles.donut, { gap: spacing[1] }]} testID="hub-impact-damage">
            <Text style={caption}>{t("eventHub.impact.damage.title")}</Text>
            <DonutChart
              slices={damage.slices}
              size={donut}
              maxLegendRows={4}
              title={t("eventHub.impact.damage.title")}
              {...donutCentre(damage.total, locale, t)}
            />
          </View>
        ) : null}
        {people ? (
          <View style={[styles.donut, { gap: spacing[1] }]} testID="hub-impact-people">
            <Text style={caption}>{t("eventHub.impact.people.title")}</Text>
            <DonutChart
              slices={people.slices}
              size={donut}
              maxLegendRows={4}
              title={t("eventHub.impact.people.title")}
              {...donutCentre(people.total, locale, t)}
            />
          </View>
        ) : null}
      </View>
    </SlideFrame>
  );
}

/** The donut's middle: the figure, and the unit word on its own line
 * ("7.8" over "million"), so it fits the hole in every language. */
function donutCentre(
  total: number,
  locale: string,
  t: TFunction,
): { centerText: string; centerUnit?: string } {
  const { figure, unit } = approximateParts(total, locale);
  return {
    centerText: isolateNumeric(figure),
    ...(unit ? { centerUnit: t(`eventHub.impact.unit.${unit}`) } : {}),
  };
}

/** Slide 3: felt shaking by town. A level only with 3 reports or more. */
export function FeltTownsSlide({
  size,
  towns,
}: {
  size: number;
  towns: readonly FeltTown[];
}) {
  const { t, i18n } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const locale = i18n.language;
  // The count cell hugs the row END (E-22): physical right in LTR, left in RTL.
  const endAlign = isRTLLocale(locale) ? "left" : "right";
  const shown = towns.slice(0, 7);
  const max = Math.max(1, ...shown.map((town) => town.reports));
  const label = {
    color: colors.text.primary,
    fontSize: typography.labelCaption.fontSize,
    fontFamily: nativeFontFamily(typography.labelCaption, "400"),
    lineHeight: typography.labelCaption.lineHeight,
  } as const;
  return (
    <SlideFrame
      size={size}
      title={t("eventHub.slides.towns.title")}
      subtitle={t("eventHub.slides.towns.subtitle")}
      note={t("eventHub.slides.towns.note")}
      testID="slide-towns"
    >
      <View style={{ gap: spacing[1] }}>
        {shown.map((town) => {
          const city = GAZETTEER_CITIES.find((candidate) => candidate.id === town.townId);
          const name = city ? pickLocalizedName(city.names, locale) : town.townId;
          const countText = isolateNumeric(localizeDigits(String(town.reports), locale));
          const levelName =
            town.level !== null ? t(`felt.tier1.levels.${town.level}.label`) : null;
          const levelText =
            town.level !== null ? formatIntensity(town.level, locale) : null;
          return (
            <View
              key={town.townId}
              accessible
              accessibilityLabel={
                levelText && levelName
                  ? t("eventHub.slides.towns.a11y", {
                      town: name,
                      level: levelText,
                      label: levelName,
                      number: countText,
                    })
                  : t("eventHub.slides.towns.a11yCountOnly", {
                      town: name,
                      number: countText,
                    })
              }
              style={[styles.townRow, { gap: spacing[2] }]}
              testID={`slide-town-${town.townId}`}
            >
              <Text style={[label, styles.townName]} numberOfLines={1}>
                {name}
              </Text>
              <View
                style={[
                  styles.levelChip,
                  levelText && town.level !== null
                    ? {
                        backgroundColor: colors.intensity[town.level],
                        borderColor: colors.border.default,
                      }
                    : { borderColor: colors.border.default },
                ]}
              >
                <Text
                  style={{
                    fontSize: typography.labelCaption.fontSize,
                    fontFamily: nativeFontFamily(typography.labelCaption, "700"),
                    fontWeight: "700",
                    color:
                      levelText && town.level !== null
                        ? (colors.intensityOnFill[town.level] ?? colors.text.primary)
                        : colors.text.tertiary,
                  }}
                >
                  {levelText ?? "–"}
                </Text>
              </View>
              <Text
                style={[label, styles.levelName, { color: colors.text.secondary }]}
                numberOfLines={1}
              >
                {levelName ?? ""}
              </Text>
              <View style={[styles.track, { backgroundColor: colors.surface.sunken }]}>
                <View
                  style={{
                    width: `${Math.max(8, Math.round((town.reports / max) * 100))}%`,
                    backgroundColor: colors.text.secondary,
                    borderRadius: 3,
                  }}
                />
              </View>
              <Text style={[label, styles.count, { textAlign: endAlign }]}>{countText}</Text>
            </View>
          );
        })}
      </View>
    </SlideFrame>
  );
}

/** Slide 4: reports over time, first 24 hours: bars per hour, the running
 * total as a line. The time axis runs left to right in every language, as
 * on a map. */
export function TimelineSlide({
  size,
  timeline,
}: {
  size: number;
  timeline: FeltTimeline;
}) {
  const { t, i18n } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const locale = i18n.language;
  const num = (value: number) => isolateNumeric(localizeDigits(String(value), locale));
  const chartWidth = size - 32;
  const chartHeight = Math.max(80, size - 230);
  const maxHour = Math.max(1, ...timeline.hours);
  const totals = runningTotal(timeline.hours);
  const maxTotal = Math.max(1, totals[totals.length - 1] ?? 1);
  const barWidth = chartWidth / 24;
  const linePoints = totals
    .map(
      (value, hour) =>
        `${(hour + 0.5) * barWidth},${chartHeight - (value / maxTotal) * (chartHeight - 4)}`,
    )
    .join(" ");
  const stat = (value: string, labelText: string, testID: string) => (
    <View
      style={[
        styles.stat,
        { backgroundColor: colors.surface.sunken, padding: spacing[2] },
      ]}
      testID={testID}
      accessible
      accessibilityLabel={`${value} ${labelText}`}
    >
      <Text style={[typography.labelButton, { color: colors.text.primary }]}>
        {value}
      </Text>
      <Text
        style={[typography.labelCaption, { color: colors.text.secondary }]}
        numberOfLines={2}
      >
        {labelText}
      </Text>
    </View>
  );
  const caption = {
    color: colors.text.secondary,
    fontSize: typography.labelCaption.fontSize,
    fontFamily: nativeFontFamily(typography.labelCaption, "400"),
  };
  return (
    <SlideFrame
      size={size}
      title={t("eventHub.slides.timeline.title")}
      subtitle={t("eventHub.slides.timeline.subtitle")}
      testID="slide-timeline"
    >
      <View style={{ gap: spacing[2] }}>
        <View style={[styles.stats, { gap: spacing[2] }]}>
          {stat(
            num(timeline.firstDay),
            t("eventHub.slides.timeline.reports"),
            "slide-timeline-total",
          )}
          {timeline.minutesToFirst !== null
            ? stat(
                t("eventHub.slides.timeline.minutes", {
                  number: num(timeline.minutesToFirst),
                }),
                t("eventHub.slides.timeline.toFirst"),
                "slide-timeline-first",
              )
            : null}
          {stat(
            num(timeline.firstHour),
            t("eventHub.slides.timeline.firstHour"),
            "slide-timeline-hour",
          )}
        </View>
        <View
          style={{ direction: "ltr" }}
          accessible
          accessibilityLabel={t("eventHub.slides.timeline.chartA11y", {
            number: num(timeline.firstDay),
          })}
        >
          <Svg width={chartWidth} height={chartHeight}>
            <Line
              x1={0}
              y1={chartHeight - 0.5}
              x2={chartWidth}
              y2={chartHeight - 0.5}
              stroke={colors.border.default}
              strokeWidth={1}
            />
            {timeline.hours.map((value, hour) =>
              value > 0 ? (
                <Rect
                  key={hour}
                  x={hour * barWidth + 1}
                  y={chartHeight - (value / maxHour) * (chartHeight - 4)}
                  width={Math.max(1, barWidth - 2)}
                  height={(value / maxHour) * (chartHeight - 4)}
                  fill={colors.brand.primary}
                />
              ) : null,
            )}
            <Polyline
              points={linePoints}
              fill="none"
              stroke={colors.text.primary}
              strokeWidth={2}
            />
          </Svg>
          <View style={styles.axis}>
            {[0, 6, 12, 18, 24].map((hour) => (
              <Text key={hour} style={caption}>
                {t("eventHub.slides.timeline.hour", { number: num(hour) })}
              </Text>
            ))}
          </View>
        </View>
        <View style={[styles.legend, { gap: spacing[3] }]}>
          <View style={[styles.legendItem, { gap: spacing[1] }]}>
            <View style={[styles.legendBar, { backgroundColor: colors.brand.primary }]} />
            <Text style={caption}>{t("eventHub.slides.timeline.perHour")}</Text>
          </View>
          <View style={[styles.legendItem, { gap: spacing[1] }]}>
            <View style={[styles.legendLine, { backgroundColor: colors.text.primary }]} />
            <Text style={caption}>{t("eventHub.slides.timeline.running")}</Text>
          </View>
        </View>
      </View>
    </SlideFrame>
  );
}

/** Slide 5: damage by building class, DG1..DG5 per vulnerability class. */
export function ClassDamageSlide({
  size,
  rows,
  reviewed,
}: {
  size: number;
  rows: readonly ClassDamageRow[];
  reviewed: boolean;
}) {
  const { t, i18n } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const locale = i18n.language;
  // The percent cells hug the row END (E-22): physical right in LTR, left in RTL.
  const endAlign = isRTLLocale(locale) ? "left" : "right";
  const pct = (share: number) =>
    isolateNumeric(
      t("donut.percent", { value: localizeDigits(percentValue(share), locale) }),
    );
  const caption = {
    color: colors.text.secondary,
    fontSize: typography.labelCaption.fontSize,
    fontFamily: nativeFontFamily(typography.labelCaption, "400"),
  };
  return (
    <SlideFrame
      size={size}
      title={t("eventHub.slides.classes.title")}
      subtitle={t("eventHub.slides.classes.subtitle")}
      note={
        reviewed
          ? t("eventHub.slides.classes.noteReviewed")
          : t("eventHub.slides.classes.note")
      }
      testID="slide-classes"
    >
      <View style={{ gap: spacing[2] }}>
        <View style={[styles.classRow, { gap: spacing[2] }]}>
          <Text style={[caption, styles.classLetterCol]}>
            {t("eventHub.slides.classes.class")}
          </Text>
          <Text style={[caption, styles.flex]}>{t("eventHub.slides.classes.share")}</Text>
          <Text style={[caption, styles.pct, { textAlign: endAlign }]}>
            {t("eventHub.slides.classes.dg4")}
          </Text>
        </View>
        {rows.map((row) => (
          <View
            key={row.vulnerabilityClass}
            style={[styles.classRow, { gap: spacing[2] }]}
            accessible
            accessibilityLabel={t("eventHub.slides.classes.a11y", {
              vc: row.vulnerabilityClass,
              dg1: pct(row.shares[0]),
              dg2: pct(row.shares[1]),
              dg3: pct(row.shares[2]),
              dg4: pct(row.shares[3]),
              dg5: pct(row.shares[4]),
            })}
            testID={`slide-class-${row.vulnerabilityClass}`}
          >
            <View
              style={[
                styles.classLetter,
                styles.classLetterCol,
                {
                  borderColor: colors.border.default,
                  backgroundColor: colors.surface.sunken,
                },
              ]}
            >
              <Text
                style={[
                  typography.labelCaption,
                  { color: colors.text.primary, fontWeight: "700" },
                ]}
              >
                {row.vulnerabilityClass}
              </Text>
            </View>
            <View style={[styles.stack, { backgroundColor: colors.surface.sunken }]}>
              {row.shares.map((share, grade) =>
                share > 0 ? (
                  <View
                    key={grade}
                    style={{
                      width: `${Math.max(1, share * 100)}%`,
                      backgroundColor: colors.damageGrade[grade + 1],
                    }}
                  />
                ) : null,
              )}
            </View>
            <Text
              style={[
                typography.labelCaption,
                styles.pct,
                { color: colors.text.primary, textAlign: endAlign },
              ]}
            >
              {pct(row.dg4Plus)}
            </Text>
          </View>
        ))}
        <View style={[styles.legend, { gap: spacing[2] }]}>
          {[1, 2, 3, 4, 5].map((grade) => (
            <View key={grade} style={[styles.legendItem, { gap: 4 }]}>
              <View
                style={[styles.swatch, { backgroundColor: colors.damageGrade[grade] }]}
              />
              <Text style={caption}>
                {t("eventHub.slides.classes.grade", {
                  number: localizeDigits(String(grade), locale),
                })}
              </Text>
            </View>
          ))}
        </View>
      </View>
    </SlideFrame>
  );
}

const styles = StyleSheet.create({
  frame: { borderWidth: 1, borderRadius: 12, overflow: "hidden" },
  body: { flex: 1, justifyContent: "center" },
  donuts: {
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "flex-start",
  },
  donut: { flex: 1, alignItems: "center" },
  townRow: { flexDirection: "row", alignItems: "center", minHeight: 24 },
  townName: { width: "26%" },
  levelChip: {
    minWidth: 30,
    height: 20,
    borderRadius: 4,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 3,
  },
  levelName: { width: "22%" },
  track: {
    flex: 1,
    height: 8,
    borderRadius: 4,
    overflow: "hidden",
    flexDirection: "row",
  },
  // Numeric cells align to the row END; the physical side is chosen at
  // render time from the locale (E-22), see `endAlign` in each slide.
  count: { minWidth: 22 },
  stats: { flexDirection: "row" },
  stat: { flex: 1, borderRadius: 8 },
  axis: { flexDirection: "row", justifyContent: "space-between" },
  legend: { flexDirection: "row", flexWrap: "wrap", alignItems: "center" },
  legendItem: { flexDirection: "row", alignItems: "center" },
  legendBar: { width: 10, height: 10, borderRadius: 2 },
  legendLine: { width: 14, height: 2 },
  classRow: { flexDirection: "row", alignItems: "center", minHeight: 22 },
  classLetterCol: { width: 28 },
  classLetter: {
    height: 20,
    borderRadius: 4,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  flex: { flex: 1 },
  stack: {
    flex: 1,
    height: 12,
    borderRadius: 3,
    overflow: "hidden",
    flexDirection: "row",
  },
  pct: { width: 40 },
  swatch: { width: 10, height: 10, borderRadius: 2 },
});
