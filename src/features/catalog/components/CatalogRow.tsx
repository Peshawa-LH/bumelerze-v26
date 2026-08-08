import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme } from "@/theme";
import {
  formatCatalogMagnitude,
  formatCatalogPlace,
  formatCatalogYear,
} from "../format";
import type { CatalogRow as CatalogRowData } from "../types";

interface CatalogRowProps {
  row: CatalogRowData;
  onPress: (row: CatalogRowData) => void;
}

/** One archival-catalog list row: year, magnitude, gazetteer place line,
 * source chip (provenance principle — every catalog value's origin is
 * always visible, PROJECT.md gotcha on never scattering unlabeled
 * feed-specific data through the UI). Tapping opens `CatalogDetailSheet`. */
export function CatalogRow({ row, onPress }: CatalogRowProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const { colors, typography, spacing } = useTheme();

  const yearText = formatCatalogYear(row.year, locale);
  const magnitudeText = formatCatalogMagnitude(row, locale, t);
  const placeText = formatCatalogPlace(row, locale, t);
  const sourceLabel = t(`catalog.sources.${row.sourceCatalog}`);

  const accessibilityLabel = [yearText, magnitudeText, placeText, sourceLabel].join(". ");

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={() => onPress(row)}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: colors.surface.raised,
          borderColor: colors.border.default,
          padding: spacing[4],
          gap: spacing[1],
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      <View style={styles.topRow}>
        <Text
          style={{
            color: colors.text.secondary,
            fontSize: typography.labelCaption.fontSize,
            lineHeight: typography.labelCaption.lineHeight,
            fontVariant: ["tabular-nums"],
          }}
        >
          {yearText}
        </Text>
        <Text
          allowFontScaling
          style={{
            color: colors.text.primary,
            fontSize: typography.magnitudeCompact.fontSize,
            lineHeight: typography.magnitudeCompact.lineHeight,
            fontWeight: typography.magnitudeCompact.fontWeight,
            fontVariant: ["tabular-nums"],
          }}
        >
          {magnitudeText}
        </Text>
      </View>

      <Text
        style={{
          color: colors.text.primary,
          fontSize: typography.bodyDefault.fontSize,
          lineHeight: typography.bodyDefault.lineHeight,
        }}
      >
        {placeText}
      </Text>

      <View
        style={[
          styles.sourceChip,
          { borderColor: colors.border.subtle, paddingHorizontal: spacing[2] },
        ]}
      >
        <Text
          style={{
            color: colors.text.secondary,
            fontSize: typography.labelCaption.fontSize,
            fontWeight: typography.labelCaption.fontWeight,
          }}
        >
          {sourceLabel}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    borderWidth: 1,
    borderRadius: 12,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sourceChip: {
    alignSelf: "flex-start",
    borderWidth: 1,
    borderRadius: 999,
    minHeight: 24,
    justifyContent: "center",
  },
});
