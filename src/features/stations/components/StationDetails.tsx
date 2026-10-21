import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { isolateNumeric } from "@/features/events";
import { isolateName } from "@/features/geo";
import { directionProps, directionStyle } from "@/i18n";
import { useTheme, nativeFontFamily, READING_START } from "@/theme";
import type { UseStationTraceResult } from "../queries";
import type { LiveStation } from "../types";
import { freshnessColor } from "./colors";
import { StationTraceChart } from "./StationTraceChart";

interface StationDetailsProps {
  station: LiveStation;
  /** The station's live trace, owned by `StationsPanel` so the list tier and
   * this header badge come from ONE source (B-26: the list said "Delayed"
   * while this header said "Live" seconds later, each from its own fetch). */
  trace: UseStationTraceResult;
}

/** One station: identity, distance, freshness badge, the last ten
 * minutes, and the data credit. Polling lives in the panel (queries.ts). */
export function StationDetails({ station, trace }: StationDetailsProps) {
  const { t, i18n } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const { status, trace: samples, freshness, lagMs, streaming } = trace;
  const locale = i18n.language;
  const dirProps = directionProps(locale);
  const dirStyle = directionStyle(locale);

  const badgeColor = freshnessColor(colors, freshness);
  const tierLabel =
    status === "loading"
      ? t("stations.tier.unknown")
      : t(`stations.tier.${freshness === "unknown" ? "silent" : freshness}`);

  return (
    <View style={{ gap: spacing[2] }}>
      <View style={[styles.headerRow, { gap: spacing[2] }]}>
        <Text
          {...dirProps}
          style={{
            flexShrink: 1,
            color: colors.text.primary,
            fontSize: typography.h3.fontSize,
            fontFamily: nativeFontFamily(typography.h3),
            lineHeight: typography.h3.lineHeight,
            fontWeight: typography.h3.fontWeight,
            ...dirStyle,
          }}
        >
          {isolateName(station.name)}
        </Text>
        <View
          testID="station-details-badge"
          style={[
            styles.badge,
            { backgroundColor: badgeColor, paddingHorizontal: spacing[2] },
          ]}
        >
          <Text
            style={{
              color: "#FFFFFF",
              fontSize: typography.labelCaption.fontSize,
              fontFamily: nativeFontFamily(typography.labelCaption, "700"),
              ...READING_START,
              fontWeight: "700",
            }}
          >
            {tierLabel}
          </Text>
        </View>
      </View>
      {/* The station code and "channel · N samples/s" are Latin/number
       * chunks, each isolated as one unit; the distance phrase is the
       * locale's own sentence with its digits already localised
       * (`{{km, digits}}`). The line itself follows the app language (B-6). */}
      <Text
        testID="station-details-meta"
        {...dirProps}
        style={{
          color: colors.text.secondary,
          fontSize: typography.bodyMeta.fontSize,
          fontFamily: nativeFontFamily(typography.bodyMeta),
          lineHeight: typography.bodyMeta.lineHeight,
          ...dirStyle,
        }}
      >
        {[
          isolateNumeric(station.id),
          isolateNumeric(t("stations.channel", { channel: station.channel, sps: station.sps })),
          t("stations.distanceFromReference", { km: Math.round(station.distanceKmFromErbil) }),
        ].join(" · ")}
      </Text>

      <StationTraceChart
        trace={samples}
        accessibilityLabel={t("stations.chartA11yLabel", { name: station.name })}
      />

      <Text
        accessibilityLiveRegion="polite"
        {...dirProps}
        style={{
          color: colors.text.secondary,
          fontSize: typography.bodyMeta.fontSize,
          fontFamily: nativeFontFamily(typography.bodyMeta),
          lineHeight: typography.bodyMeta.lineHeight,
          ...dirStyle,
        }}
      >
        {status === "loading"
          ? t("stations.loading")
          : status === "error"
            ? t("stations.error")
            : status === "empty"
              ? t("stations.noData")
              : streaming
                ? t("stations.streaming", {
                    seconds: Math.max(0, Math.round((lagMs ?? 0) / 1000)),
                  })
                : (lagMs ?? 0) < 60_000
                  ? t("stations.lastSampleSeconds", {
                      seconds: Math.max(0, Math.round((lagMs ?? 0) / 1000)),
                    })
                  : t("stations.lastSample", {
                      minutes: Math.round((lagMs ?? 0) / 60000),
                    })}
      </Text>
      <Text
        {...dirProps}
        style={{
          color: colors.text.tertiary,
          fontSize: typography.labelCaption.fontSize,
          fontFamily: nativeFontFamily(typography.labelCaption, "400"),
          lineHeight: typography.labelCaption.lineHeight,
          ...dirStyle,
        }}
      >
        {t("stations.credit", { credit: isolateName(station.credit) })}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  badge: { borderRadius: 999, paddingVertical: 3 },
});
