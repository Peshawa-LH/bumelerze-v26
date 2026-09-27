import { Stack } from "expo-router";
import { useState } from "react";
import { Platform, ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  findLiveStation,
  listLiveStations,
  StationDetails,
  StationList,
  StationsMap,
} from "@/features/stations";
import { useTheme } from "@/theme";

/**
 * Live seismic stations (owner, 2026-09-27): the second half of the Sensor
 * tab — open stations around Kurdistan on a map, tap one to watch its last
 * ten minutes. Data come from the stations' own public FDSN services,
 * minutes behind real time; the screen says so. Phase 1: polling only.
 */
export default function StationsScreen() {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const stations = listLiveStations();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = selectedId ? (findLiveStation(selectedId) ?? null) : null;
  const isWeb = Platform.OS === "web";

  return (
    <>
      <Stack.Screen options={{ title: t("stations.title") }} />
      <ScrollView
        style={{ backgroundColor: colors.surface.base }}
        contentContainerStyle={{
          paddingTop: spacing[4],
          paddingBottom: insets.bottom + spacing[6],
          paddingStart: spacing[4],
          paddingEnd: spacing[4],
          gap: spacing[4],
        }}
      >
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
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        </View>
      </ScrollView>
    </>
  );
}
