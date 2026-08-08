import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { localizeDigits } from "@/lib/format-numbers";
import { useTheme } from "@/theme";
import { CATALOG_MAG_STEP, CATALOG_YEAR_STEP } from "../config";
import { formatCatalogYear } from "../format";
import { CATALOG_SOURCES, type CatalogBounds, type CatalogSource } from "../types";
import { NumericStepper } from "./NumericStepper";

export interface CatalogFilterValues {
  magMin: number;
  magMax: number;
  yearMin: number;
  yearMax: number;
  sources: readonly CatalogSource[];
}

interface CatalogFilterBarProps {
  bounds: CatalogBounds;
  values: CatalogFilterValues;
  onChange: (next: CatalogFilterValues) => void;
}

/**
 * The three filter groups the wave brief asked for: magnitude range, year
 * range, source-catalog chips. All "boring RN controls, big touch
 * targets" (steppers + toggle chips, no custom slider). An empty
 * `sources` selection means "all sources" (see `types.ts`'s
 * `CatalogFilters` doc comment) — tapping a chip toggles membership in
 * that set directly, no separate "All" pseudo-chip needed since the
 * results-count line already makes "no filter applied" legible.
 */
export function CatalogFilterBar({ bounds, values, onChange }: CatalogFilterBarProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const { colors, typography, spacing } = useTheme();

  function formatMag(value: number): string {
    return localizeDigits(value.toFixed(1), locale);
  }

  function toggleSource(source: CatalogSource) {
    const isSelected = values.sources.includes(source);
    const nextSources = isSelected
      ? values.sources.filter((s) => s !== source)
      : [...values.sources, source];
    onChange({ ...values, sources: nextSources });
  }

  return (
    <View style={[styles.container, { gap: spacing[4], padding: spacing[4] }]}>
      <View style={[styles.stepperRow, { gap: spacing[4] }]}>
        <NumericStepper
          label={t("catalog.filters.magMinLabel")}
          value={values.magMin}
          min={bounds.magMin}
          max={values.magMax}
          step={CATALOG_MAG_STEP}
          formatValue={formatMag}
          onChange={(next) => onChange({ ...values, magMin: next })}
          decrementA11yLabel={t("catalog.filters.decrement")}
          incrementA11yLabel={t("catalog.filters.increment")}
        />
        <NumericStepper
          label={t("catalog.filters.magMaxLabel")}
          value={values.magMax}
          min={values.magMin}
          max={bounds.magMax}
          step={CATALOG_MAG_STEP}
          formatValue={formatMag}
          onChange={(next) => onChange({ ...values, magMax: next })}
          decrementA11yLabel={t("catalog.filters.decrement")}
          incrementA11yLabel={t("catalog.filters.increment")}
        />
      </View>

      <View style={[styles.stepperRow, { gap: spacing[4] }]}>
        <NumericStepper
          label={t("catalog.filters.yearMinLabel")}
          value={values.yearMin}
          min={bounds.yearMin}
          max={values.yearMax}
          step={CATALOG_YEAR_STEP}
          formatValue={(v) => formatCatalogYear(v, locale)}
          onChange={(next) => onChange({ ...values, yearMin: next })}
          decrementA11yLabel={t("catalog.filters.decrement")}
          incrementA11yLabel={t("catalog.filters.increment")}
        />
        <NumericStepper
          label={t("catalog.filters.yearMaxLabel")}
          value={values.yearMax}
          min={values.yearMin}
          max={bounds.yearMax}
          step={CATALOG_YEAR_STEP}
          formatValue={(v) => formatCatalogYear(v, locale)}
          onChange={(next) => onChange({ ...values, yearMax: next })}
          decrementA11yLabel={t("catalog.filters.decrement")}
          incrementA11yLabel={t("catalog.filters.increment")}
        />
      </View>

      <View style={[styles.chipsWrap, { gap: spacing[2] }]}>
        {CATALOG_SOURCES.map((source) => {
          const isSelected = values.sources.includes(source);
          return (
            <Pressable
              key={source}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: isSelected }}
              accessibilityLabel={t(`catalog.sources.${source}`)}
              onPress={() => toggleSource(source)}
              style={[
                styles.chip,
                {
                  borderColor: isSelected ? colors.brand.primary : colors.border.default,
                  backgroundColor: isSelected ? colors.brand.primary : "transparent",
                  paddingHorizontal: spacing[3],
                },
              ]}
            >
              <Text
                style={{
                  color: isSelected ? colors.brand.onPrimary : colors.text.primary,
                  fontSize: typography.labelCaption.fontSize,
                  fontWeight: typography.labelCaption.fontWeight,
                }}
              >
                {t(`catalog.sources.${source}`)}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "column",
  },
  stepperRow: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  chipsWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  chip: {
    borderWidth: 1,
    borderRadius: 999,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
});
