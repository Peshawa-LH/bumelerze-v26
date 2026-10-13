import { useTranslation } from "react-i18next";
import { View } from "react-native";

import type { CatalogRow as CatalogRowData } from "@/features/catalog";
import { CatalogRow } from "@/features/catalog/components/CatalogRow";
import { NumericStepper } from "@/features/catalog/components/NumericStepper";
import { CATALOG_FIRST_YEAR, catalogCurrentYear } from "@/features/catalog/filter-input";
import { formatCatalogYear } from "@/features/catalog/format";
import { useTheme } from "@/theme";

const noop = () => undefined;

/** The 2017 Halabja (Sarpol-e Zahab) mainshock, as the catalogue lists it. */
const HALABJA_2017: CatalogRowData = {
  bumelerzeId: "bml2017000s",
  time: Date.UTC(2017, 10, 12, 18, 18, 17) / 1000,
  year: 2017,
  lat: 34.91,
  lon: 45.96,
  depthKm: 19,
  mag: 7.3,
  magType: "Mw",
  mwDerived: 7.3,
  mwMethod: "native_mw",
  sourceCatalog: "USGS",
  sourceId: null,
  contributingSources: "USGS",
  mergedCount: 1,
  authorAgency: null,
  region: null,
};

/** Catalogue: the real year filter set to the whole span (872 to this year)
 * and one real catalogue row. */
export function CatalogPreview() {
  const { t, i18n } = useTranslation();
  const { spacing } = useTheme();
  const thisYear = catalogCurrentYear();
  const formatYear = (value: number) => formatCatalogYear(value, i18n.language);
  return (
    <View style={{ gap: spacing[3] }}>
      <View style={{ flexDirection: "row", gap: spacing[3] }}>
        <View style={{ flex: 1 }}>
          <NumericStepper
            label={t("catalog.filters.yearMinLabel")}
            value={CATALOG_FIRST_YEAR}
            min={CATALOG_FIRST_YEAR}
            max={thisYear}
            step={10}
            formatValue={formatYear}
            onChange={noop}
            decrementA11yLabel={t("catalog.filters.decrement")}
            incrementA11yLabel={t("catalog.filters.increment")}
            editable={false}
          />
        </View>
        <View style={{ flex: 1 }}>
          <NumericStepper
            label={t("catalog.filters.yearMaxLabel")}
            value={thisYear}
            min={CATALOG_FIRST_YEAR}
            max={thisYear}
            step={10}
            formatValue={formatYear}
            onChange={noop}
            decrementA11yLabel={t("catalog.filters.decrement")}
            incrementA11yLabel={t("catalog.filters.increment")}
            editable={false}
          />
        </View>
      </View>
      <CatalogRow row={HALABJA_2017} onPress={noop} />
    </View>
  );
}
