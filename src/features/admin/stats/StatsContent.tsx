import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { communityErrorText } from "@/features/community/error-text";
import { ActionButton } from "@/features/eventhub/components/ActionButton";
import type { EventHubTransport } from "@/features/eventhub/transport";
import { useTheme } from "@/theme";
import { useAdminAccess } from "../queries";
import { ChoiceChips, ToolCard, ToolPage, useTextDir } from "../ui";
import { areaName } from "./area-name";
import { TimeChart, VcRows, dayMonth, useNumber } from "./charts";
import { useAdminStats } from "./queries";
import type { StatsTransport } from "./transport";
import { STATS_RANGES, type AdminStats, type StatsRange } from "./types";

/**
 * Admin > Statistics (review 15.2, mockup 5b): range chips, four headline
 * numbers, six simple charts. Counts only: the server never sends a name, a
 * place finer than a town or a device id, and the footer says so.
 */
export function StatsContent({
  transport,
  hubTransport,
}: {
  transport?: StatsTransport;
  hubTransport?: EventHubTransport;
}) {
  const { t } = useTranslation();
  const { colors, typography } = useTheme();
  const access = useAdminAccess(hubTransport);
  const [range, setRange] = useState<StatsRange>(30);
  const allowed = access.has("stats.read");
  const stats = useAdminStats(range, allowed, transport);
  const num = useNumber();
  const meta = [typography.bodyMeta, { color: colors.text.secondary }];

  if (!allowed) {
    return access.isLoading ? null : (
      <ToolPage testID="stats-page">
        <Text style={meta} testID="stats-no-access">
          {t("community.errors.forbidden")}
        </Text>
      </ToolPage>
    );
  }

  const rangeLabel = (r: StatsRange) =>
    r === "all"
      ? t("admin.stats.rangeAll")
      : t("admin.stats.rangeDays", { number: num(r) });

  return (
    <ToolPage testID="stats-page" footer={t("admin.stats.footer")}>
      <ChoiceChips
        label={t("admin.stats.rangeLabel")}
        options={STATS_RANGES.map((r) => ({ value: r, label: rangeLabel(r) }))}
        value={range}
        onChange={setRange}
        testID="stats-range"
      />
      {stats.isLoading ? (
        <Text style={meta} testID="stats-loading">
          {t("eventDetail.loading")}
        </Text>
      ) : stats.isError || !stats.data ? (
        <View style={{ gap: 8 }}>
          <Text
            accessibilityRole="alert"
            style={[meta, { color: colors.status.danger }]}
            testID="stats-error"
          >
            {communityErrorText(t, stats.error)}
          </Text>
          <ActionButton
            label={t("events.retry")}
            onPress={() => void stats.refetch()}
            testID="stats-retry"
          />
        </View>
      ) : (
        <StatsBody data={stats.data} />
      )}
    </ToolPage>
  );
}

function StatsBody({ data }: { data: AdminStats }) {
  const { t, i18n } = useTranslation();
  const { colors, spacing } = useTheme();
  const num = useNumber();
  const dates = data.series.map((p) => p.date);
  const sum = (key: "accounts" | "felt" | "checkins" | "comments") =>
    data.series.reduce((total, p) => total + p[key], 0);
  const peak = (key: "felt" | "checkins") =>
    data.series.reduce<{ date: string; value: number } | null>(
      (best, p) => (p[key] > (best?.value ?? 0) ? { date: p.date, value: p[key] } : best),
      null,
    );
  const perStep =
    data.step === "week" ? t("admin.stats.perWeek") : t("admin.stats.perDay");
  const day = (d: string) => dayMonth(d, i18n.language, t);
  const feltPeak = peak("felt");
  const last = data.series[data.series.length - 1];
  const devices = last?.devices ?? { web: 0, ios: 0, android: 0, other: 0 };
  const deviceSeries = (
    [
      { key: "ios", color: colors.brand.primary },
      { key: "android", color: colors.status.success },
      { key: "web", color: colors.status.warning },
      { key: "other", color: colors.text.tertiary },
    ] as const
  ).filter((s) => s.key !== "other" || data.series.some((p) => p.devices.other > 0));

  return (
    <>
      <View style={[styles.headline, { gap: spacing[2] }]} testID="stats-headline">
        <Headline
          value={num(data.totals.accounts)}
          label={t("admin.stats.accounts")}
          extra={t("admin.stats.newInRange", { number: num(data.totals.accountsNew) })}
          testID="stats-accounts"
        />
        <Headline
          value={num(data.totals.felt)}
          label={t("admin.stats.feltReports")}
          extra={
            feltPeak
              ? t("admin.stats.busiest", {
                  day: day(feltPeak.date),
                  number: num(feltPeak.value),
                })
              : null
          }
          testID="stats-felt"
        />
        <Headline
          value={num(data.totals.checkins)}
          label={t("admin.stats.checkins")}
          testID="stats-checkins"
        />
        <Headline
          value={num(data.totals.waiting)}
          label={t("admin.stats.waiting")}
          testID="stats-waiting"
        />
      </View>

      <ToolCard
        title={t("admin.stats.newAccountsTitle")}
        subtitle={`${perStep} · ${t("admin.stats.inRange", { number: num(sum("accounts")) })}`}
        testID="stats-chart-accounts"
      >
        <TimeChart
          dates={dates}
          series={[
            {
              key: "accounts",
              label: t("admin.stats.newAccountsTitle"),
              values: data.series.map((p) => p.accounts),
              color: colors.brand.primary,
              kind: "bars",
            },
          ]}
          a11yLabel={t("admin.stats.chartA11y", {
            title: t("admin.stats.newAccountsTitle"),
            number: num(sum("accounts")),
          })}
        />
      </ToolCard>

      <ToolCard
        title={t("admin.stats.feltTitle")}
        subtitle={
          feltPeak
            ? `${perStep} · ${t("admin.stats.busiest", { day: day(feltPeak.date), number: num(feltPeak.value) })}`
            : perStep
        }
        testID="stats-chart-felt"
      >
        <TimeChart
          dates={dates}
          series={[
            {
              key: "felt",
              label: t("admin.stats.feltTitle"),
              values: data.series.map((p) => p.felt),
              color: colors.status.danger,
              kind: "bars",
            },
          ]}
          a11yLabel={t("admin.stats.chartA11y", {
            title: t("admin.stats.feltTitle"),
            number: num(sum("felt")),
          })}
        />
      </ToolCard>

      <ToolCard
        title={t("admin.stats.checkinsTitle")}
        subtitle={`${perStep} · ${t("admin.stats.total", { number: num(sum("checkins")) })} · ${t("admin.stats.checkinsKept")}`}
        testID="stats-chart-checkins"
      >
        <TimeChart
          dates={dates}
          series={[
            {
              key: "checkins",
              label: t("admin.stats.checkinsTitle"),
              values: data.series.map((p) => p.checkins),
              color: colors.status.success,
              kind: "line",
            },
          ]}
          a11yLabel={t("admin.stats.chartA11y", {
            title: t("admin.stats.checkinsTitle"),
            number: num(sum("checkins")),
          })}
        />
      </ToolCard>

      <ToolCard
        title={t("admin.stats.commentsTitle")}
        subtitle={t("admin.stats.commentsSubtitle")}
        testID="stats-chart-comments"
      >
        <TimeChart
          dates={dates}
          series={[
            {
              key: "comments",
              label: t("admin.stats.commentsLegend"),
              values: data.series.map((p) => p.comments),
              color: colors.brand.primary,
              kind: "bars",
            },
            {
              key: "waiting",
              label: t("admin.stats.waitingLegend"),
              values: data.series.map((p) => p.waiting),
              color: colors.status.warning,
              kind: "line",
            },
          ]}
          a11yLabel={t("admin.stats.commentsA11y", {
            comments: num(sum("comments")),
            waiting: num(data.series.reduce((total, p) => total + p.waiting, 0)),
          })}
        />
      </ToolCard>

      <ToolCard
        title={t("admin.stats.buildingsTitle")}
        subtitle={t("admin.stats.buildingsSubtitle", {
          number: num(data.buildings.homes),
        })}
        testID="stats-buildings"
      >
        <VcRows counts={data.buildings.classes} testID="stats-vc" />
        {data.buildings.areas.length > 0 ? (
          <Text style={{ color: colors.text.secondary }} testID="stats-areas">
            {t("admin.stats.byArea", {
              list: data.buildings.areas
                .slice(0, 8)
                .map((a) => `${areaName(a.area, i18n.language, t)} ${num(a.homes)}`)
                .join(" · "),
            })}
          </Text>
        ) : null}
      </ToolCard>

      <ToolCard
        title={t("admin.stats.devicesTitle")}
        subtitle={t("admin.stats.devicesNow", {
          ios: num(devices.ios),
          android: num(devices.android),
          web: num(devices.web),
        })}
        testID="stats-devices"
      >
        <TimeChart
          dates={dates}
          series={deviceSeries.map((s) => ({
            key: s.key,
            label: t(`admin.stats.platforms.${s.key}`),
            values: data.series.map((p) => p.devices[s.key]),
            color: s.color,
            kind: "line" as const,
          }))}
          a11yLabel={t("admin.stats.devicesNow", {
            ios: num(devices.ios),
            android: num(devices.android),
            web: num(devices.web),
          })}
        />
        <Text style={{ color: colors.text.tertiary }}>
          {t("admin.stats.devicesNote")}
        </Text>
      </ToolCard>
    </>
  );
}

function Headline({
  value,
  label,
  extra,
  testID,
}: {
  value: string;
  label: string;
  extra?: string | null;
  testID: string;
}) {
  const { colors, typography, spacing } = useTheme();
  const dir = useTextDir();
  return (
    <View
      accessible
      accessibilityLabel={[value, label, extra].filter(Boolean).join(", ")}
      testID={testID}
      style={[
        styles.box,
        {
          backgroundColor: colors.surface.raised,
          borderColor: colors.border.default,
          padding: spacing[3],
        },
      ]}
    >
      <Text style={[typography.h2, dir, { color: colors.text.primary }]}>{value}</Text>
      <Text style={[typography.bodyMeta, dir, { color: colors.text.secondary }]}>
        {label}
      </Text>
      {extra ? (
        <Text style={[typography.labelCaption, dir, { color: colors.status.success }]}>
          {extra}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  headline: { flexDirection: "row", flexWrap: "wrap" },
  box: {
    flexBasis: "47%",
    flexGrow: 1,
    maxWidth: "50%",
    borderWidth: 1,
    borderRadius: 14,
  },
});
