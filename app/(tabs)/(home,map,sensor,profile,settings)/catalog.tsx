import { Stack } from "expo-router";
import { useTranslation } from "react-i18next";

import { HeaderBackButton } from "@/components/HeaderBackButton";
import { lazyScreenContent } from "@/components/LazyScreenContent";
import { loadCatalogArea } from "@/features/catalog/area-loader";

// On the web, downloaded the first time the catalog is opened, never at start-up
// (src/features/catalog/area.ts).
const CatalogDatabaseScreen = lazyScreenContent(
  loadCatalogArea,
  (area) => area.CatalogDatabaseScreen,
  { loadWhenShown: true },
);

/**
 * Catalog route: the bundled, offline Kurdistan/Iraq earthquake catalog
 * (150,072 events). Reachable from Home's header link row and a "full
 * catalog" row on the Historical screen (both push here). The screen itself,
 * with its SQLite database, is `CatalogDatabaseScreen`.
 */
export default function CatalogScreen() {
  const { t } = useTranslation();

  return (
    <>
      <Stack.Screen
        options={{
          title: t("catalog.title"),
          headerShown: true,
          headerLeft: () => <HeaderBackButton />,
        }}
      />
      <CatalogDatabaseScreen />
    </>
  );
}
