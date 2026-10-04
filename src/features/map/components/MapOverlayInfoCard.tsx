import { Ionicons } from "@expo/vector-icons";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { formatDepthKm, formatMagnitudeValue, isolateNumeric } from "@/features/events";
import { formatFixedLocalized, localizeDigits } from "@/lib/format-numbers";
import { useTheme } from "@/theme";

import type { FaultInfo, OverlayInfo, QuakeInfo } from "../overlay-info";

interface MapOverlayInfoCardProps {
  info: OverlayInfo;
  onClose: () => void;
}

/** A tapped fault or past earthquake, described in plain language with
 * its source always named (owner: "we always write source"). */
export function MapOverlayInfoCard({ info, onClose }: MapOverlayInfoCardProps) {
  const { t, i18n } = useTranslation();
  const { colors, spacing, typography } = useTheme();
  const body = {
    color: colors.text.secondary,
    fontSize: typography.bodyMeta.fontSize,
    lineHeight: typography.bodyMeta.lineHeight,
  } as const;
  const title = {
    color: colors.text.primary,
    fontSize: typography.bodyDefault.fontSize,
    lineHeight: typography.bodyDefault.lineHeight,
    fontWeight: "700" as const,
  };
  const lines =
    info.kind === "fault"
      ? faultLines(info, t, i18n.language)
      : quakeLines(info, t, i18n.language);

  return (
    <View
      testID="map-overlay-info"
      accessibilityLiveRegion="polite"
      style={[
        styles.card,
        {
          backgroundColor: colors.surface.raised,
          borderColor: colors.border.default,
          padding: spacing[3],
          gap: spacing[1],
        },
      ]}
    >
      <View style={[styles.header, { gap: spacing[2] }]}>
        <Text style={[title, styles.flex]}>{lines.title}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("map.overlayInfo.close")}
          onPress={onClose}
          hitSlop={12}
        >
          <Ionicons name="close" size={18} color={colors.text.secondary} />
        </Pressable>
      </View>
      {lines.rows.map((row) => (
        <Text key={row} style={body}>
          {row}
        </Text>
      ))}
    </View>
  );
}

function faultLines(
  info: FaultInfo,
  t: TFunction,
  locale: string,
): { title: string; rows: string[] } {
  const sense = t(`map.overlayInfo.sense.${info.primary}`);
  const rows: string[] = [];
  rows.push(
    info.secondary
      ? t("map.overlayInfo.senseWithSecondary", {
          primary: sense,
          secondary: t(`map.overlayInfo.senseShort.${info.secondary}`),
        })
      : sense,
  );
  if (info.zone && info.zone !== info.name)
    rows.push(t("map.overlayInfo.zone", { zone: info.zone }));
  if (info.slipRate) {
    const n = (v: number) => isolateNumeric(formatFixedLocalized(v, 1, locale));
    rows.push(
      info.slipRate.min !== null && info.slipRate.max !== null
        ? t("map.overlayInfo.slipRateRange", {
            preferred: n(info.slipRate.preferred),
            min: n(info.slipRate.min),
            max: n(info.slipRate.max),
          })
        : t("map.overlayInfo.slipRate", { preferred: n(info.slipRate.preferred) }),
    );
  }
  if (info.rateRank) rows.push(t(`map.overlayInfo.rateRank${info.rateRank}`));
  if (info.confidence) rows.push(t(`map.overlayInfo.confidence${info.confidence}`));
  if (info.references)
    rows.push(t("map.overlayInfo.references", { refs: info.references }));
  rows.push(
    info.source === "afead"
      ? t("map.overlayInfo.sourceAfead")
      : t("map.overlayInfo.sourceGem", { catalog: info.catalog ?? "GEM" }),
  );
  return { title: info.name ?? t("map.overlayInfo.faultTitle"), rows };
}

function quakeLines(
  info: QuakeInfo,
  t: TFunction,
  locale: string,
): { title: string; rows: string[] } {
  const magnitude = isolateNumeric(
    t("events.magnitudeDisplay", { value: formatMagnitudeValue(info.magnitude, locale) }),
  );
  const when =
    info.timeMs !== null && info.year >= 1900
      ? new Date(info.timeMs).toISOString().slice(0, 10)
      : String(info.year);
  const rows: string[] = [
    info.depthKm !== null
      ? t("map.overlayInfo.magDepth", {
          type: info.magType,
          depth: isolateNumeric(
            `${formatDepthKm(info.depthKm, locale)} ${t("units.km")}`,
          ),
        })
      : info.magType,
  ];
  if (info.era !== "modern") rows.push(t(`map.overlayInfo.era.${info.era}`));
  rows.push(t("map.overlayInfo.catalogue", { source: info.source, id: info.id }));
  return {
    title: t("map.overlayInfo.quakeTitle", {
      magnitude,
      when: isolateNumeric(localizeDigits(when, locale)),
    }),
    rows,
  };
}

const styles = StyleSheet.create({
  card: {
    position: "absolute",
    bottom: 28,
    left: 8,
    right: 8,
    maxWidth: 420,
    alignSelf: "center",
    marginHorizontal: "auto",
    borderWidth: 1,
    borderRadius: 12,
  },
  header: { flexDirection: "row", alignItems: "flex-start" },
  flex: { flex: 1 },
});
