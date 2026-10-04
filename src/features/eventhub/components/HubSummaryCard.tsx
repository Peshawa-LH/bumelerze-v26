import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { formatAbsoluteDual, isolateNumeric } from "@/features/events";
import { localizeDigits } from "@/lib/format-numbers";
import { useTheme } from "@/theme";

import type { HubSummary } from "../types";

interface HubSummaryCardProps {
  /** Null while unknown (loading or unavailable). */
  summary: HubSummary | null;
}

/**
 * Felt summary: how many people reported, the spread of reported shaking
 * levels (same labels and colours as the felt flow), and when the first
 * report came in. Aggregates only, so nothing here can identify a person or
 * a place.
 */
export function HubSummaryCard({ summary }: HubSummaryCardProps) {
  const { t, i18n } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const locale = i18n.language;

  if (!summary) {
    return null;
  }

  const body = {
    color: colors.text.secondary,
    fontSize: typography.bodyMeta.fontSize,
    lineHeight: typography.bodyMeta.lineHeight,
  } as const;

  const levels = Object.entries(summary.levels)
    .map(([level, count]) => ({ level: Number(level), count }))
    .filter((row) => row.count > 0)
    .sort((a, b) => a.level - b.level);
  const maxCount = Math.max(1, ...levels.map((row) => row.count));

  return (
    <View
      testID="hub-summary"
      style={[
        styles.card,
        {
          backgroundColor: colors.surface.raised,
          borderColor: colors.border.default,
          padding: spacing[4],
          gap: spacing[3],
        },
      ]}
    >
      {summary.reports === 0 ? (
        <Text
          style={{
            color: colors.text.primary,
            fontSize: typography.bodyDefault.fontSize,
            lineHeight: typography.bodyDefault.lineHeight,
          }}
        >
          {summary.featured ? t("eventHub.summary.memories") : t("eventHub.summary.none")}
        </Text>
      ) : (
        <>
          <Text
            style={{
              color: colors.text.primary,
              fontSize: typography.h3.fontSize,
              lineHeight: typography.h3.lineHeight,
              fontWeight: typography.h3.fontWeight,
            }}
          >
            {t("eventHub.summary.people", {
              number: isolateNumeric(localizeDigits(String(summary.people), locale)),
            })}
          </Text>

          <View style={{ gap: spacing[2] }}>
            {levels.map(({ level, count }) => {
              const label = t(`felt.tier1.levels.${level}.label`);
              const countText = isolateNumeric(localizeDigits(String(count), locale));
              return (
                <View
                  key={level}
                  testID={`hub-level-${level}`}
                  accessible
                  accessibilityLabel={t("eventHub.summary.levelA11y", {
                    label,
                    number: countText,
                  })}
                  style={[styles.levelRow, { gap: spacing[2], minHeight: 28 }]}
                >
                  <View
                    style={[
                      styles.swatch,
                      {
                        backgroundColor: colors.intensity[level] ?? colors.surface.sunken,
                        borderColor: colors.border.default,
                      },
                    ]}
                  />
                  <Text style={[body, styles.levelLabel]} numberOfLines={1}>
                    {label}
                  </Text>
                  <View
                    style={[styles.barTrack, { backgroundColor: colors.surface.sunken }]}
                  >
                    <View
                      style={[
                        styles.barFill,
                        {
                          width: `${Math.max(6, Math.round((count / maxCount) * 100))}%`,
                          backgroundColor:
                            colors.intensity[level] ?? colors.brand.primary,
                          borderColor: colors.border.default,
                        },
                      ]}
                    />
                  </View>
                  <Text style={[body, styles.count]}>{countText}</Text>
                </View>
              );
            })}
          </View>

          {summary.firstReportAt !== null ? (
            <Text style={body}>
              {t("eventHub.summary.firstReport", {
                time: isolateNumeric(
                  formatAbsoluteDual(summary.firstReportAt, locale, t).local,
                ),
              })}
            </Text>
          ) : null}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 12,
  },
  levelRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  swatch: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 1,
  },
  levelLabel: {
    width: 120,
  },
  barTrack: {
    flex: 1,
    height: 10,
    borderRadius: 5,
    overflow: "hidden",
    // The bar grows from the start edge in both reading directions.
    flexDirection: "row",
  },
  barFill: {
    height: 10,
    borderRadius: 5,
    borderWidth: StyleSheet.hairlineWidth,
  },
  count: {
    minWidth: 28,
  },
});
