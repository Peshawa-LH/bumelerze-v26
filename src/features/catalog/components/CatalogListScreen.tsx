import { useState } from "react";
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "@/theme";
import { useCatalogBounds, useCatalogList } from "../use-catalog";
import { formatCatalogResultsCount } from "../format";
import type { CatalogFilters, CatalogRow as CatalogRowData } from "../types";
import { CatalogDetailSheet } from "./CatalogDetailSheet";
import { CatalogFilterBar, type CatalogFilterValues } from "./CatalogFilterBar";
import { CatalogRow } from "./CatalogRow";

/**
 * The Catalog browser's actual content — split out from `app/catalog.tsx`
 * (which only wraps this in `<SQLiteProvider>`) so it can be unit-tested by
 * mocking `../use-catalog` directly, the same "mock the data hook, test the
 * presentational component" pattern `ShakeMapSection.test.tsx` uses for
 * `useShakeMap` — no real SQLite native module needed in Jest.
 *
 * These are archival, bundled, offline-by-construction events (wave brief):
 * no refetch/retry affordance on error, since a local bundled-db read
 * failing once will fail identically on retry — the error state here exists
 * only so a failure is never silent (PROJECT.md rule), not because retrying
 * would plausibly help.
 */
export function CatalogListScreen() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const { colors, typography, spacing } = useTheme();
  const insets = useSafeAreaInsets();

  const { bounds, isLoading: isBoundsLoading, error: boundsError } = useCatalogBounds();
  const [filterValues, setFilterValues] = useState<CatalogFilterValues | null>(null);
  const [selectedRow, setSelectedRow] = useState<CatalogRowData | null>(null);

  // Seed the filter UI's steppers from the db's OWN min/max the first time
  // bounds finish loading (see config.ts's doc comment on why these aren't
  // hardcoded) — a no-op on every render after that, since `filterValues`
  // is only initialized once, then only ever changed by the filter bar.
  const effectiveFilterValues: CatalogFilterValues | null =
    filterValues ??
    (bounds
      ? { magMin: bounds.magMin, magMax: bounds.magMax, yearMin: bounds.yearMin, yearMax: bounds.yearMax, sources: [] }
      : null);

  // Not memoized: `useCatalogList` only cares about these VALUES (it
  // compares a `JSON.stringify`'d key, not object identity — see that
  // hook's doc comment), so recomputing this small plain object on every
  // render is cheap and avoids a `useMemo` dependency that would itself
  // need to watch every individual field of `effectiveFilterValues`.
  const queryFilters: CatalogFilters = effectiveFilterValues
    ? {
        magMin: effectiveFilterValues.magMin,
        magMax: effectiveFilterValues.magMax,
        yearMin: effectiveFilterValues.yearMin,
        yearMax: effectiveFilterValues.yearMax,
        ...(effectiveFilterValues.sources.length > 0
          ? { sources: effectiveFilterValues.sources }
          : {}),
      }
    : {};

  const { rows, totalCount, isLoading, isLoadingMore, hasMore, error, loadMore } =
    useCatalogList(queryFilters);

  const anyError = boundsError ?? error;
  const isInitialLoading = isBoundsLoading || (isLoading && rows.length === 0);

  if (anyError) {
    return (
      <View
        style={[
          styles.centered,
          { backgroundColor: colors.surface.base, padding: spacing[5] },
        ]}
      >
        <Text
          accessibilityRole="alert"
          style={{
            color: colors.status.danger,
            fontSize: typography.bodyDefault.fontSize,
            lineHeight: typography.bodyDefault.lineHeight,
            textAlign: "center",
          }}
        >
          {t("catalog.errorTitle")}
        </Text>
      </View>
    );
  }

  if (isInitialLoading || !bounds || !effectiveFilterValues) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.surface.base }]}>
        <ActivityIndicator accessibilityLabel={t("catalog.loading")} />
      </View>
    );
  }

  return (
    <View style={[styles.flex, { backgroundColor: colors.surface.base }]}>
      <FlatList
        data={rows}
        keyExtractor={(row) => row.id}
        renderItem={({ item }) => <CatalogRow row={item} onPress={setSelectedRow} />}
        onEndReachedThreshold={0.4}
        onEndReached={() => {
          if (hasMore) {
            loadMore();
          }
        }}
        ListHeaderComponent={
          <View style={{ gap: spacing[2] }}>
            <CatalogFilterBar
              bounds={bounds}
              values={effectiveFilterValues}
              onChange={setFilterValues}
            />
            <Text
              style={{
                color: colors.text.secondary,
                fontSize: typography.bodyMeta.fontSize,
                lineHeight: typography.bodyMeta.lineHeight,
                paddingHorizontal: spacing[4],
              }}
            >
              {formatCatalogResultsCount(totalCount, locale, t)}
            </Text>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text
              style={{
                color: colors.text.secondary,
                fontSize: typography.bodyDefault.fontSize,
                lineHeight: typography.bodyDefault.lineHeight,
                textAlign: "center",
              }}
            >
              {t("catalog.emptyState")}
            </Text>
          </View>
        }
        ListFooterComponent={
          isLoadingMore ? (
            <View style={{ paddingVertical: spacing[4] }}>
              <ActivityIndicator accessibilityLabel={t("catalog.loading")} />
            </View>
          ) : null
        }
        contentContainerStyle={{
          gap: spacing[3],
          paddingHorizontal: spacing[4],
          paddingTop: spacing[3],
          paddingBottom: insets.bottom + spacing[6],
          flexGrow: 1,
        }}
      />
      <CatalogDetailSheet row={selectedRow} onClose={() => setSelectedRow(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyState: {
    paddingVertical: 32,
    paddingHorizontal: 16,
  },
});
