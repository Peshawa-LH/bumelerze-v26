import { Stack } from "expo-router";
import { deleteDatabaseAsync, SQLiteProvider } from "expo-sqlite";
import { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { useTheme } from "@/theme";
import {
  CATALOG_DATABASE_NAME,
  CatalogListScreen,
  LEGACY_CATALOG_DATABASE_NAMES,
} from "@/features/catalog";

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
 *
 * Stale-copy cleanup runs from `onInit`, NOT a sibling `useEffect` on this
 * screen component — on web, every expo-sqlite call (this provider's own
 * open included) is routed through one shared worker/VFS singleton, and
 * firing a second `deleteDatabaseAsync` call from a parallel effect races
 * that singleton's lazy init against the provider's own asset-import open.
 * Chrome tolerates the overlap; Safari/WebKit's OPFS access-handle locking
 * does not — two concurrent inits fight over the same pool files and throw
 * (`UnknownError: operation failed for unknown transient reason`), which
 * crashed the whole Catalog screen (caught via a WebKit repro, not just
 * asset-URL inspection). `onInit` runs strictly after the main database is
 * open and before children render, so cleanup is sequenced onto the
 * already-initialized VFS instead of racing it.
 *
 * `<ErrorBoundary>` wraps `<SQLiteProvider>` as a second, independent line
 * of defense: even with the race above removed, opening a WebKit-backed
 * OPFS database can still fail for reasons outside app code (browser
 * storage-quota heuristics for a given origin, low-storage devices) —
 * `SQLiteProviderNonSuspense` rethrows any open failure as an uncaught
 * render error with no boundary of its own, which otherwise crashes this
 * whole screen to a blank output. `retryKey` forces a full remount of
 * `<SQLiteProvider>` on retry (its internal open effect has no caching, so
 * a fresh mount genuinely retries the open, not just clears old UI state).
 */
export default function CatalogScreen() {
  const { t } = useTranslation();
  const [retryKey, setRetryKey] = useState(0);

  const cleanUpLegacyDatabases = useCallback(async () => {
    // Fire-and-forget per name — a failure (file never existed, platform
    // quirk) costs nothing but a few stranded megabytes, so no error UI.
    // Sequential (not Promise.all) keeps every delete on this same
    // already-open VFS one at a time, matching the ordering guarantee this
    // fix depends on.
    for (const legacyName of LEGACY_CATALOG_DATABASE_NAMES) {
      await deleteDatabaseAsync(legacyName).catch(() => undefined);
    }
  }, []);

  return (
    <>
      <Stack.Screen options={{ title: t("catalog.title"), headerShown: true }} />
      <ErrorBoundary
        fallback={(_error, retry) => (
          <CatalogUnavailable
            onRetry={() => {
              retry();
              setRetryKey((key) => key + 1);
            }}
          />
        )}
      >
        <SQLiteProvider
          key={retryKey}
          databaseName={CATALOG_DATABASE_NAME}
          // Metro asset resolution needs a literal, static `require()` call
          // here (it statically scans the source for these) — this is the
          // documented expo-sqlite bundled-asset pattern, not something an
          // import statement can express, hence the lint suppression on the
          // require() line itself (must be directly above it, not above this
          // comment block, or the directive reports as unused).
          // Relative path, NOT the "@/" alias: "@/*" maps to "./src/*"
          // (tsconfig paths), but the bundled db lives at the repo-root
          // assets/ directory — the alias resolved to a nonexistent
          // src/assets/... and broke Metro bundling.
          // eslint-disable-next-line @typescript-eslint/no-require-imports -- Metro asset require, see comment above
          assetSource={{ assetId: require("../assets/catalog/bumelerze-catalog.sqlite") }}
          onInit={cleanUpLegacyDatabases}
        >
          <CatalogListScreen />
        </SQLiteProvider>
      </ErrorBoundary>
    </>
  );
}

function CatalogUnavailable({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();

  return (
    <View
      style={[styles.centered, { backgroundColor: colors.surface.base, padding: spacing[5] }]}
    >
      <Text
        accessibilityRole="alert"
        style={{
          color: colors.text.primary,
          fontSize: typography.h3.fontSize,
          lineHeight: typography.h3.lineHeight,
          fontWeight: typography.h3.fontWeight,
          textAlign: "center",
          marginBottom: spacing[3],
        }}
      >
        {t("catalog.errorTitle")}
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={onRetry}
        style={[
          styles.retryButton,
          { backgroundColor: colors.brand.primary, paddingHorizontal: spacing[5], paddingVertical: spacing[3] },
        ]}
      >
        <Text
          style={{
            color: colors.brand.onPrimary,
            fontSize: typography.labelButton.fontSize,
            fontWeight: typography.labelButton.fontWeight,
          }}
        >
          {t("catalog.retry")}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  retryButton: {
    borderRadius: 10,
  },
});
