import { Stack } from "expo-router";
import { SQLiteProvider } from "expo-sqlite";
import { useTranslation } from "react-i18next";

import { CATALOG_DATABASE_NAME, CatalogListScreen } from "@/features/catalog";

/**
 * Catalog screen (regional-catalog wave) — the bundled, offline Kurdistan/
 * Iraq earthquake catalog (872-2023, `shake-service/scripts/
 * build_regional_catalog.py`; see `shake-service/regional-catalog/
 * BUILD_REPORT.md` for source counts and data-quality notes). Reachable
 * from Home's header link row and a "full catalog" row on the Historical
 * screen (both push here).
 *
 * `SQLiteProvider`'s `assetSource` is expo-sqlite's own standard bundled-
 * asset pattern: on first open it copies `assets/catalog/
 * bumelerze-catalog.sqlite` from the app bundle into the document
 * directory (as `CATALOG_DATABASE_NAME`) and opens THAT copy — every
 * subsequent launch just opens the already-copied file directly. The
 * actual query logic (filters, paging) lives in `CatalogListScreen` /
 * `use-catalog.ts`, split out specifically so it can be unit-tested by
 * mocking that hook, without needing this native-module provider in Jest.
 */
export default function CatalogScreen() {
  const { t } = useTranslation();

  return (
    <>
      <Stack.Screen options={{ title: t("catalog.title"), headerShown: true }} />
      <SQLiteProvider
        databaseName={CATALOG_DATABASE_NAME}
        // Metro asset resolution needs a literal, static `require()` call
        // here (it statically scans the source for these) — this is the
        // documented expo-sqlite bundled-asset pattern, not something an
        // import statement can express, hence the lint suppression.
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- Metro asset require, see comment above
        // Relative path, NOT the "@/" alias: "@/*" maps to "./src/*"
        // (tsconfig paths), but the bundled db lives at the repo-root
        // assets/ directory — the alias resolved to a nonexistent
        // src/assets/... and broke Metro bundling.
        assetSource={{ assetId: require("../assets/catalog/bumelerze-catalog.sqlite") }}
      >
        <CatalogListScreen />
      </SQLiteProvider>
    </>
  );
}
