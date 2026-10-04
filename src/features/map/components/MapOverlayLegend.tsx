import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { isRTLLocale } from "@/i18n";
import { useTheme } from "@/theme";

import {
  FAULT_COLORS,
  HISTORICAL_ERA_COLORS,
  SITE_CLASS_COLORS,
  type OverlayLayerId,
} from "../layer-registry";
import { VS30_OVERLAY_CLASSES } from "../vs30-overlay";

interface MapOverlayLegendProps {
  active: readonly OverlayLayerId[];
  /** Phone width: start collapsed so the legend never covers the map. */
  compact: boolean;
}

/**
 * What the switched-on context layers mean: fault slip families (shared by
 * AFEAD and GEM), past-earthquake eras, ground site classes. Only the
 * sections for active layers appear; nothing renders when none is on.
 */
export function MapOverlayLegend({ active, compact }: MapOverlayLegendProps) {
  const { t, i18n } = useTranslation();
  const { colors, scheme, spacing, typography } = useTheme();
  const [expanded, setExpanded] = useState(!compact);
  if (active.length === 0) return null;

  const rtl = isRTLLocale(i18n.language);
  const showFaults = active.includes("faults-afead") || active.includes("faults-gem");
  const showQuakes = active.includes("historical-quakes");
  const showSite = active.includes("site-vs30");
  const era = HISTORICAL_ERA_COLORS[scheme];

  const label = {
    color: colors.text.primary,
    fontSize: typography.labelCaption.fontSize,
    lineHeight: typography.labelCaption.fontSize * 1.35,
  } as const;
  const note = { ...label, color: colors.text.secondary } as const;
  const heading = { ...label, fontWeight: "700" as const };

  const line = (color: string, text: string) => (
    <View key={text} style={[styles.row, { gap: spacing[2] }]}>
      <View style={[styles.lineSwatch, { backgroundColor: color }]} />
      <Text style={label}>{text}</Text>
    </View>
  );
  const dot = (color: string, size: number, text: string) => (
    <View key={text} style={[styles.row, { gap: spacing[2] }]}>
      <View style={styles.dotBox}>
        <View
          style={{
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: color,
          }}
        />
      </View>
      <Text style={label}>{text}</Text>
    </View>
  );
  const box = (color: string, text: string) => (
    <View key={text} style={[styles.row, { gap: spacing[2] }]}>
      <View style={[styles.boxSwatch, { backgroundColor: color }]} />
      <Text style={label}>{text}</Text>
    </View>
  );

  return (
    <View
      testID="map-overlay-legend"
      style={[
        styles.card,
        rtl ? styles.right : styles.left,
        {
          backgroundColor: colors.surface.raised,
          borderColor: colors.border.default,
          padding: spacing[2],
          gap: spacing[2],
        },
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("map.legend.title")}
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((v) => !v)}
        style={[styles.row, { gap: spacing[1] }]}
        hitSlop={8}
      >
        <Ionicons name="list-outline" size={14} color={colors.text.secondary} />
        <Text style={heading}>{t("map.legend.title")}</Text>
        <Ionicons
          name={expanded ? "chevron-down" : "chevron-up"}
          size={14}
          color={colors.text.secondary}
        />
      </Pressable>
      {expanded ? (
        <ScrollView style={styles.body} contentContainerStyle={{ gap: spacing[2] }}>
          {showFaults ? (
            <View style={{ gap: spacing[1] }}>
              <Text style={heading}>{t("map.legend.faults")}</Text>
              {line(FAULT_COLORS.reverse, t("map.legend.reverse"))}
              {line(FAULT_COLORS.normal, t("map.legend.normal"))}
              {line(FAULT_COLORS.strikeSlip, t("map.legend.strikeSlip"))}
              {line(FAULT_COLORS.other, t("map.legend.other"))}
              {active.includes("faults-afead") ? (
                <Text style={note}>{t("map.legend.afeadConfidence")}</Text>
              ) : null}
            </View>
          ) : null}
          {showQuakes ? (
            <View style={{ gap: spacing[1] }}>
              <Text style={heading}>{t("map.legend.quakes")}</Text>
              {dot(era.historical, 9, t("map.legend.eraHistorical"))}
              {dot(era.early, 9, t("map.legend.eraEarly"))}
              {dot(era.modern, 9, t("map.legend.eraModern"))}
              <Text style={note}>{t("map.legend.quakeSize")}</Text>
            </View>
          ) : null}
          {showSite ? (
            <View style={{ gap: spacing[1] }}>
              <Text style={heading}>{t("map.legend.site")}</Text>
              {VS30_OVERLAY_CLASSES.map((c) =>
                box(SITE_CLASS_COLORS[c], t(`map.legend.siteClass${c}`)),
              )}
              <Text style={note}>{t("map.legend.siteNote")}</Text>
            </View>
          ) : null}
        </ScrollView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    position: "absolute",
    bottom: 28,
    maxWidth: 240,
    // Never taller than most of the map: three sections overflow a phone.
    maxHeight: "62%",
    borderWidth: 1,
    borderRadius: 10,
  },
  left: { left: 8 },
  right: { right: 8 },
  body: { flexShrink: 1 },
  row: { flexDirection: "row", alignItems: "center" },
  lineSwatch: { width: 18, height: 3, borderRadius: 2 },
  dotBox: { width: 18, alignItems: "center", justifyContent: "center" },
  boxSwatch: { width: 14, height: 10, borderRadius: 2, opacity: 0.8 },
});
