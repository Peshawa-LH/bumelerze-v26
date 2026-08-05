import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { pickLocalizedName } from "@/features/geo";
import { useTheme } from "@/theme";
import { HOME_BASE_ELSEWHERE_ID, HOME_BASE_TOWNS } from "../towns";

interface TownPickerProps {
  selectedTownId: string | null;
  onSelectTown: (townId: string) => void;
  onSelectElsewhere: () => void;
}

/**
 * The HomeBase town list (wave brief point 1/5) — shared between the
 * onboarding HomeBase screen and the Settings "change HomeBase" row so the
 * ~20-town list and its selection behavior exist in exactly one place.
 * Deliberately not a map (MapLibre is Phase 3 — see towns.ts's upgrade-path
 * comment); this is a plain scrollable list, same pattern as the Settings
 * language rows.
 */
export function TownPicker({
  selectedTownId,
  onSelectTown,
  onSelectElsewhere,
}: TownPickerProps) {
  const { t, i18n } = useTranslation();
  const { colors, typography, spacing } = useTheme();

  return (
    <View style={{ gap: spacing[2] }}>
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
              },
            ]}
          >
            <Text
              style={{
                color: colors.text.primary,
                fontSize: typography.bodyDefault.fontSize,
                fontWeight: isActive ? "700" : "400",
              }}
            >
              {pickLocalizedName(town.names, i18n.language)}
            </Text>
          </Pressable>
        );
      })}
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected: selectedTownId === HOME_BASE_ELSEWHERE_ID }}
        onPress={onSelectElsewhere}
        style={[
          styles.row,
          {
            borderColor: colors.border.default,
            backgroundColor:
              selectedTownId === HOME_BASE_ELSEWHERE_ID
                ? colors.surface.raised
                : "transparent",
          },
        ]}
      >
        <Text
          style={{
            color: colors.text.secondary,
            fontSize: typography.bodyDefault.fontSize,
            fontWeight: selectedTownId === HOME_BASE_ELSEWHERE_ID ? "700" : "400",
          }}
        >
          {t("onboarding.homeBase.elsewhere")}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 12,
    paddingStart: 16,
    paddingEnd: 16,
  },
});
