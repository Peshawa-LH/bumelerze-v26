import { useMemo, useState } from "react";
import { Platform, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { loadNativeMapLibre } from "@/features/map/native-maplibre";
import { useTheme, nativeFontFamily } from "@/theme";
import { findLiveStation, listLiveStations } from "../catalog";
import { useStationFreshness, useStationTrace } from "../queries";
import type { StationFreshness } from "../types";
import { StationDetails } from "./StationDetails";
import { StationLegend } from "./StationLegend";
import { StationList } from "./StationList";
import { StationsMap } from "./StationsMap";

/**
 * The live-stations half of the Sensor tab (owner, 2026-09-27: inside the
 * tab, bottom tabs staying put — not a pushed screen). Map + legend,
 * the selected station's ten minutes, and the list. Data come from the
 * stations' own public FDSN services, minutes behind real time.
 *
 * One status source (B-26): the catalogue probe (`useStationFreshness`, every
 * two minutes) paints every station, but the selected station's own trace
 * fetch (`useStationTrace`, every 15-30 s) knows better the moment it
 * answers — so its freshness overrides the probe's tier for that one
 * station in the list and on the map, and the detail header reads the same
 * value. Before, the list could say "Delayed" while the header said "Live".
 */
export function StationsPanel() {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const stations = listLiveStations();
  const probedTiers = useStationFreshness(stations);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = selectedId ? (findLiveStation(selectedId) ?? null) : null;
  const trace = useStationTrace(selected);
  // The map shows on the web and wherever MapLibre's native code is in the
  // build; Expo Go keeps the list-only note.
  const [hasMap] = useState(() => Platform.OS === "web" || loadNativeMapLibre() !== null);

  const tiers = useMemo<Record<string, StationFreshness>>(() => {
    // "unknown" means the trace has not answered yet (idle/loading/error);
    // the probe's tier stands until it does.
    if (!selected || trace.freshness === "unknown") {
      return probedTiers;
    }
    return { ...probedTiers, [selected.id]: trace.freshness };
  }, [probedTiers, selected, trace.freshness]);

  return (
    <View style={{ gap: spacing[4] }}>
      <Text
        style={{
          color: colors.text.secondary,
          fontSize: typography.bodyDefault.fontSize,
          fontFamily: nativeFontFamily(typography.bodyDefault),
          lineHeight: typography.bodyDefault.lineHeight,
        }}
      >
        {t("stations.intro")}
      </Text>

      {hasMap ? (
        <StationsMap
          stations={stations}
          tiers={tiers}
          selectedId={selectedId}
          onSelect={setSelectedId}
          accessibilityLabel={t("stations.mapA11yLabel")}
        />
      ) : (
        <Text
          style={{
            color: colors.text.tertiary,
            fontSize: typography.bodyMeta.fontSize,
            fontFamily: nativeFontFamily(typography.bodyMeta),
            lineHeight: typography.bodyMeta.lineHeight,
          }}
        >
          {t("stations.webOnlyMap")}
        </Text>
      )}

      <StationLegend />

      {selected ? <StationDetails station={selected} trace={trace} /> : null}

      <View style={{ gap: spacing[2] }}>
        <Text
          style={{
            color: colors.text.secondary,
            fontSize: typography.labelCaption.fontSize,
            fontFamily: nativeFontFamily(typography.labelCaption, "600"),
            lineHeight: typography.labelCaption.lineHeight,
            fontWeight: "600",
          }}
        >
          {t("stations.listTitle", { count: stations.length })}
        </Text>
        <StationList
          stations={stations}
          tiers={tiers}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
      </View>
    </View>
  );
}
