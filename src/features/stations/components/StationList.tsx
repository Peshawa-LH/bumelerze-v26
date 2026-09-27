import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { isolateNumeric } from "@/features/events";
import { useTheme } from "@/theme";
import { freshnessFromCatalog } from "../freshness";
import type { LiveStation } from "../types";
import { freshnessColor } from "./colors";

interface StationListProps {
  stations: LiveStation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

/** The catalogue as a list, nearest first — the whole view on native
 * (no map without the dev build) and the picker under the map on web. */
export function StationList({ stations, selectedId, onSelect }: StationListProps) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const [now] = useState(() => Date.now());

  return (
    <View style={{ gap: spacing[1] }}>
      {stations.map((station) => {
        const selected = station.id === selectedId;
        const tier = freshnessFromCatalog(station.lastSeenAt, now);
        return (
          <Pressable
            key={station.id}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            onPress={() => onSelect(station.id)}
            style={[
              styles.row,
              {
                gap: spacing[3],
                paddingVertical: spacing[2],
                paddingHorizontal: spacing[3],
                backgroundColor: selected ? colors.surface.raised : "transparent",
                borderColor: selected ? colors.brand.primary : colors.border.subtle,
              },
            ]}
          >
            <View
              style={[styles.dot, { backgroundColor: freshnessColor(colors, tier) }]}
            />
            <View style={{ flex: 1 }}>
              <Text
                style={{
                  color: colors.text.primary,
                  fontSize: typography.bodyDefault.fontSize,
                  lineHeight: typography.bodyDefault.lineHeight,
                  fontWeight: selected ? "700" : "500",
                }}
              >
                {station.name}
              </Text>
              <Text
                style={{
                  color: colors.text.secondary,
                  fontSize: typography.labelCaption.fontSize,
                  lineHeight: typography.labelCaption.lineHeight,
                }}
              >
                {`${isolateNumeric(station.id)} · ${t("stations.distanceFromReference", { km: station.distanceKmFromErbil })} · ${t(`stations.tier.${tier}`)}`}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 10,
    minHeight: 48,
  },
  dot: { width: 12, height: 12, borderRadius: 6 },
});
