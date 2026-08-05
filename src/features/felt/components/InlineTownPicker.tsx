import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { pickLocalizedName } from "@/features/geo";
import { HOME_BASE_TOWNS } from "@/features/onboarding";
import { useTheme } from "@/theme";

interface InlineTownPickerProps {
  selectedTownId: string;
  onSelectTown: (townId: string) => void;
}

/**
 * Manual-location fallback for tier 1 (spec-v1.md §4.6: "manual
 * region/town picker... never blocks submission"). Deliberately NOT
 * `features/onboarding`'s `TownPicker` — that component always offers an
 * "elsewhere / skip" row (correct for HomeBase, meaningless for a felt
 * report, which always needs a real point to geolocate to) — same
 * underlying town list (`HOME_BASE_TOWNS`, the single bundled gazetteer
 * subset), a narrower selection UI.
 */
export function InlineTownPicker({
  selectedTownId,
  onSelectTown,
}: InlineTownPickerProps) {
  const { i18n } = useTranslation();
  const { colors, typography, spacing } = useTheme();

  return (
    <View style={{ gap: spacing[1] }}>
      {HOME_BASE_TOWNS.map((town) => {
        const isActive = selectedTownId === town.id;
        return (
          <Pressable
            key={town.id}
            accessibilityRole="button"
            accessibilityState={{ selected: isActive }}
            onPress={() => onSelectTown(town.id)}
            style={[
              styles.row,
              {
                borderColor: colors.border.default,
                backgroundColor: isActive ? colors.surface.raised : "transparent",
                paddingVertical: spacing[2],
                paddingStart: spacing[3],
                paddingEnd: spacing[3],
              },
            ]}
          >
            <Text
              style={{
                color: colors.text.primary,
                fontSize: typography.bodyMeta.fontSize,
                fontWeight: isActive ? "700" : "400",
              }}
            >
              {pickLocalizedName(town.names, i18n.language)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    borderWidth: 1,
    borderRadius: 8,
  },
});
