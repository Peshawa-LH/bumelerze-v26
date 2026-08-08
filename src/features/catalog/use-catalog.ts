import { useCallback, useEffect, useState } from "react";
import { useSQLiteContext } from "expo-sqlite";

import { CATALOG_PAGE_SIZE } from "./config";
import { fetchCatalogBounds, fetchCatalogCount, fetchCatalogPage } from "./db";
import type { CatalogBounds, CatalogFilters, CatalogRow } from "./types";

export interface UseCatalogListResult {
  rows: CatalogRow[];
  totalCount: number;
  /** True only for the very first load of a given filter set — the
   * skeleton/spinner case, distinct from `isLoadingMore` (scrolling for
   * another page) so the list doesn't flash back to a full-screen loading
   * state on every filter tweak once rows are already showing... actually
   * it does reset on filter change (a fresh query), which is the correct
   * "these are now different results" behavior — see the effect below. */
  isLoading: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;
  error: Error | null;
  loadMore: () => void;
}

/**
 * Owns all SQLite access for the Catalog browser screen: the current page
 * of rows for `filters`, the total matching count, and `onEndReached`
 * pagination. Must be called from inside an `<SQLiteProvider>` (see
 * `app/catalog.tsx`). Kept as the single hook the screen imports so
 * screen-render tests can mock this one module (`jest.mock("../use-
 * catalog")`) instead of needing a real SQLite native module in Jest —
 * same pattern `features/shakemap/components/ShakeMapSection.test.tsx`
 * uses for `useShakeMap`.
 */
interface CatalogListState {
  /** The `filterKey` this state was loaded for — `isLoading` below is
   * DERIVED by comparing this to the current render's `filterKey`, rather
   * than tracked as its own `useState(true)` flag. That derivation is what
   * lets the effect avoid calling `setState` synchronously at the top of
   * its body (react-hooks/set-state-in-effect) — every `setState` call
   * here happens inside a `.then`/`.catch` callback, not directly in the
   * effect's own execution, so there's no same-render cascading update. */
  key: string;
  rows: CatalogRow[];
  totalCount: number;
  error: Error | null;
}

const INITIAL_LIST_STATE: CatalogListState = { key: "", rows: [], totalCount: 0, error: null };

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

export function useCatalogList(filters: CatalogFilters): UseCatalogListResult {
  const db = useSQLiteContext();
  const [state, setState] = useState<CatalogListState>(INITIAL_LIST_STATE);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  // Filters are a small plain object recreated on every render by the
  // screen (steppers/chips derive it from local state) — comparing by
  // JSON value, not identity, is what makes the effect below only refire
  // when the actual filter VALUES change, not on every parent re-render.
  const filterKey = JSON.stringify(filters);
  const isLoading = state.key !== filterKey;

  useEffect(() => {
    let cancelled = false;

    Promise.all([
      fetchCatalogPage(db, filters, CATALOG_PAGE_SIZE, 0),
      fetchCatalogCount(db, filters),
    ])
      .then(([page, count]) => {
        if (!cancelled) {
          setState({ key: filterKey, rows: page, totalCount: count, error: null });
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setState({ key: filterKey, rows: [], totalCount: 0, error: toError(err) });
        }
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- filterKey is the intentional dependency, not `filters`'s identity
  }, [db, filterKey]);

  const loadMore = useCallback(() => {
    if (isLoading || isLoadingMore || state.rows.length >= state.totalCount) {
      return;
    }
    setIsLoadingMore(true);
    fetchCatalogPage(db, filters, CATALOG_PAGE_SIZE, state.rows.length)
      .then((page) =>
        setState((prev) => ({ ...prev, rows: [...prev.rows, ...page] })),
      )
      .catch((err: unknown) => setState((prev) => ({ ...prev, error: toError(err) })))
      .finally(() => setIsLoadingMore(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- filterKey (not `filters`'s identity) is the intentional dependency
  }, [db, filterKey, isLoading, isLoadingMore, state.rows.length, state.totalCount]);

  return {
    rows: state.rows,
    totalCount: state.totalCount,
    isLoading,
    isLoadingMore,
    hasMore: state.rows.length < state.totalCount,
    error: state.error,
    loadMore,
  };
}

export interface UseCatalogBoundsResult {
  bounds: CatalogBounds | null;
  isLoading: boolean;
  error: Error | null;
}

/** One-shot read of the bundled catalog's real min/max magnitude and year
 * (see `db.ts`'s `fetchCatalogBounds` doc comment) — the filter UI seeds
 * its stepper ranges from this on mount. */
export function useCatalogBounds(): UseCatalogBoundsResult {
  const db = useSQLiteContext();
  const [bounds, setBounds] = useState<CatalogBounds | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchCatalogBounds(db)
      .then((result) => {
        if (!cancelled) {
          setBounds(result);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err : new Error(String(err)));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [db]);

  return { bounds, isLoading, error };
}
