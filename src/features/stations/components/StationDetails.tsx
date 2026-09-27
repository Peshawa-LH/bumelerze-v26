import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme } from "@/theme";
import { useStationTrace } from "../queries";
import type { LiveStation } from "../types";
import { freshnessColor } from "./colors";
import { StationTraceChart } from "./StationTraceChart";

interface StationDetailsProps {
  station: LiveStation;
}

/** One station: identity, distance, freshness badge, the last ten
 * minutes, and the data credit. Polls while mounted (queries.ts). */
export function StationDetails({ station }: StationDetailsProps) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const { status, trace, freshness, lagMs } = useStationTrace(station);

  const badgeColor = freshnessColor(colors, freshness);
  const tierLabel =
    status === "loading"
      ? t("stations.tier.unknown")
      : t(`stations.tier.${freshness === "unknown" ? "silent" : freshness}`);

  return (
    <View style={{ gap: spacing[2] }}>
      <View style={[styles.headerRow, { gap: spacing[2] }]}>
        <Text
          style={{
            flexShrink: 1,
            color: colors.text.primary,
            fontSize: typography.h3.fontSize,
            lineHeight: typography.h3.lineHeight,
            fontWeight: typography.h3.fontWeight,
          }}
        >
          {station.name}
        </Text>
        <View
          style={[
            styles.badge,
            { backgroundColor: badgeColor, paddingHorizontal: spacing[2] },
          ]}
        >
          <Text
            style={{
              color: "#FFFFFF",
              fontSize: typography.labelCaption.fontSize,
              fontWeight: "700",
            }}
          >
            {tierLabel}
          </Text>
        </View>
      </View>
      <Text
        style={{
          color: colors.text.secondary,
          fontSize: typography.bodyMeta.fontSize,
          lineHeight: typography.bodyMeta.lineHeight,
        }}
      >
        {[
          station.id,
          t("stations.channel", { channel: station.channel, sps: station.sps }),
          t("stations.distanceFromReference", { km: station.distanceKmFromErbil }),
        ].join(" · ")}
      </Text>

      <StationTraceChart
        trace={trace}
        accessibilityLabel={t("stations.chartA11yLabel", { name: station.name })}
      />

      <Text
        accessibilityLiveRegion="polite"
        style={{
          color: colors.text.secondary,
          fontSize: typography.bodyMeta.fontSize,
          lineHeight: typography.bodyMeta.lineHeight,
        }}
      >
        {status === "loading"
          ? t("stations.loading")
          : status === "error"
            ? t("stations.error")
            : status === "empty"
              ? t("stations.noData")
              : t("stations.lastSample", {
                  minutes: Math.max(0, Math.round((lagMs ?? 0) / 60000)),
                })}
      </Text>
      <Text
        style={{
          color: colors.text.tertiary,
          fontSize: typography.labelCaption.fontSize,
          lineHeight: typography.labelCaption.lineHeight,
        }}
      >
        {t("stations.credit", { credit: station.credit })}
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
