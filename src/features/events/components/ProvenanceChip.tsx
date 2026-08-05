import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme } from "@/theme";
import type { EventProvider } from "../types";

interface ProvenanceChipProps {
  provider: EventProvider;
}

/** Small source label present on every event card and the event-detail
 * header (design-language.md §6 "Provenance as UI, not metadata" — a hard
 * trust requirement, not decoration). Only "usgs" exists today; the i18n
 * key is namespaced by provider so a future EMSC/GEOFON chip is a catalog
 * addition, not a component change. */
export function ProvenanceChip({ provider }: ProvenanceChipProps) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();

  return (
    <View
      style={[
        styles.chip,
        {
          borderColor: colors.border.default,
          backgroundColor: colors.surface.sunken,
          paddingHorizontal: spacing[2],
          paddingVertical: spacing[1] / 2,
        },
      ]}
    >
      <Text
        style={{
          color: colors.text.secondary,
          fontSize: typography.labelCaption.fontSize,
          lineHeight: typography.labelCaption.lineHeight,
          fontWeight: typography.labelCaption.fontWeight,
        }}
      >
        {t(`events.provenance.${provider}`)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    borderWidth: 1,
    borderRadius: 999,
    alignSelf: "flex-start",
  },
});
