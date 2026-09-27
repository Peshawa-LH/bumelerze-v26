import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { isolateNumeric } from "@/features/events";
import { useTheme } from "@/theme";
import type { LiveStation, StationFreshness } from "../types";
import { freshnessColor } from "./colors";

interface StationListProps {
  stations: LiveStation[];
  tiers: Record<string, StationFreshness>;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

/** The catalogue as a list, nearest first — the whole view on native
 * (no map without the dev build) and the picker under the map on web. */
export function StationList({ stations, tiers, selectedId, onSelect }: StationListProps) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();

  return (
    <View style={{ gap: spacing[1] }}>
      {stations.map((station) => {
        const selected = station.id === selectedId;
        const tier = tiers[station.id] ?? "unknown";
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
            <Ionicons name="triangle" size={14} color={freshnessColor(colors, tier)} />
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
});
