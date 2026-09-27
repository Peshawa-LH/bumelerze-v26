import { useState } from "react";
import { Platform, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme } from "@/theme";
import { findLiveStation, listLiveStations } from "../catalog";
import { useStationFreshness } from "../queries";
import { StationDetails } from "./StationDetails";
import { StationLegend } from "./StationLegend";
import { StationList } from "./StationList";
import { StationsMap } from "./StationsMap";

/**
 * The live-stations half of the Sensor tab (owner, 2026-09-27: inside the
 * tab, bottom tabs staying put — not a pushed screen). Map (web) + legend,
 * the selected station's ten minutes, and the list. Data come from the
 * stations' own public FDSN services, minutes behind real time.
 */
export function StationsPanel() {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const stations = listLiveStations();
  const tiers = useStationFreshness(stations);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = selectedId ? (findLiveStation(selectedId) ?? null) : null;
  const isWeb = Platform.OS === "web";

  return (
    <View style={{ gap: spacing[4] }}>
      <Text
        style={{
          color: colors.text.secondary,
          fontSize: typography.bodyDefault.fontSize,
          lineHeight: typography.bodyDefault.lineHeight,
        }}
      >
        {t("stations.intro")}
      </Text>

      {isWeb ? (
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
            lineHeight: typography.bodyMeta.lineHeight,
          }}
        >
          {t("stations.webOnlyMap")}
        </Text>
      )}

      <StationLegend />

      {selected ? <StationDetails station={selected} /> : null}

      <View style={{ gap: spacing[2] }}>
        <Text
          style={{
            color: colors.text.secondary,
            fontSize: typography.labelCaption.fontSize,
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
