import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { isolateNumeric } from "@/features/events";
import { isolateName } from "@/features/geo";
import { directionProps, directionStyle } from "@/i18n";
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
 * (no map without the dev build) and the picker under the map on web.
 *
 * Station names are the operators' own FDSN site names ("Kirkuk, 1",
 * "Diyala-1"): not translatable, so they are shown as delivered but
 * isolated, and every line follows the app language's direction instead of
 * its first letter. Without that a Sorani row laid out as an LTR paragraph
 * — the Latin name hugging the left edge and "MP.KIR1 · 94" split from its
 * unit "کم" across the bidi boundary (B-6). The digits come from the
 * locale template (`{{km, digits}}`), so "٩٤ کم" stays one Sorani chunk. */
export function StationList({ stations, tiers, selectedId, onSelect }: StationListProps) {
  const { t, i18n } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const locale = i18n.language;
  const dirProps = directionProps(locale);
  const dirStyle = directionStyle(locale);

  return (
    <View style={{ gap: spacing[1] }}>
      {stations.map((station) => {
        const selected = station.id === selectedId;
        const tier = tiers[station.id] ?? "unknown";
        const meta = [
          isolateNumeric(station.id),
          t("stations.distanceFromReference", { km: Math.round(station.distanceKmFromErbil) }),
          t(`stations.tier.${tier}`),
        ].join(" · ");
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
                {...dirProps}
                style={{
                  color: colors.text.primary,
                  fontSize: typography.bodyDefault.fontSize,
                  lineHeight: typography.bodyDefault.lineHeight,
                  fontWeight: selected ? "700" : "500",
                  ...dirStyle,
                }}
              >
                {isolateName(station.name)}
              </Text>
              <Text
                testID={`station-meta-${station.id}`}
                {...dirProps}
                style={{
                  color: colors.text.secondary,
                  fontSize: typography.labelCaption.fontSize,
                  lineHeight: typography.labelCaption.lineHeight,
                  ...dirStyle,
                }}
              >
                {meta}
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
