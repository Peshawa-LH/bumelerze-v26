/**
 * Query-execution layer for the Catalog browser. Deliberately depends on a
 * minimal structural interface (`CatalogDb`), not the concrete
 * `expo-sqlite` `SQLiteDatabase` class — `expo-sqlite` is a native module
 * that can't run in Jest, so every function here is unit-tested against a
 * small fake that implements just the two methods actually used
 * (`getAllAsync`/`getFirstAsync`). A real `SQLiteDatabase` (from
 * `useSQLiteContext()`) satisfies this interface as-is, no adapter needed.
 */

import {
  buildCatalogBoundsQuery,
  buildCatalogCountQuery,
  buildCatalogPageQuery,
} from "./query-builder";
import type { CatalogBounds, CatalogFilters, CatalogRow } from "./types";

export interface CatalogDb {
  getAllAsync<T>(sql: string, params: (string | number)[]): Promise<T[]>;
  getFirstAsync<T>(sql: string, params: (string | number)[]): Promise<T | null>;
}

export async function fetchCatalogPage(
  db: CatalogDb,
  filters: CatalogFilters,
  limit: number,
  offset: number,
): Promise<CatalogRow[]> {
  const { sql, params } = buildCatalogPageQuery(filters, limit, offset);
  return db.getAllAsync<CatalogRow>(sql, params);
}

export async function fetchCatalogCount(db: CatalogDb, filters: CatalogFilters): Promise<number> {
  const { sql, params } = buildCatalogCountQuery(filters);
  const row = await db.getFirstAsync<{ count: number }>(sql, params);
  return row?.count ?? 0;
}

/** Reads the bundled catalog's real min/max magnitude and year — see
 * `config.ts`'s doc comment for why the filter UI seeds its bounds from
 * this instead of a hardcoded constant. Falls back to a degenerate
 * zero-width range (never `null`/`undefined`) if the table is somehow
 * empty, so callers never need a null-check on top of this one. */
export async function fetchCatalogBounds(db: CatalogDb): Promise<CatalogBounds> {
  const { sql, params } = buildCatalogBoundsQuery();
  const row = await db.getFirstAsync<{
    magMin: number | null;
    magMax: number | null;
    yearMin: number | null;
    yearMax: number | null;
  }>(sql, params);

  return {
    magMin: row?.magMin ?? 0,
    magMax: row?.magMax ?? 0,
    yearMin: row?.yearMin ?? 0,
    yearMax: row?.yearMax ?? 0,
  };
}
