/**
 * Pure SQL-building functions for the Catalog browser — deliberately
 * separated from `db.ts`'s actual query execution so filter/mag/year/source
 * combinations are unit-testable without a real SQLite runtime (expo-sqlite
 * is a native module; Jest can't execute it). Every function here just
 * returns `{ sql, params }`; nothing touches a database.
 */

import type { CatalogFilters } from "./types";

export interface BuiltQuery {
  sql: string;
  params: (string | number)[];
}

const EVENTS_COLUMNS =
  "id, time, year, lat, lon, depth_km AS depthKm, mag, mag_type AS magType, " +
  "source_catalog AS sourceCatalog, source_id AS sourceId, " +
  "contributing_sources AS contributingSources, merged_count AS mergedCount";

/**
 * Shared `WHERE` clause builder for both the page query and the count
 * query, so the two can never drift out of sync (a mismatch there would
 * mean "N results" reporting a different count than the rows actually
 * returned). An empty/all-undefined `filters` produces no `WHERE` clause
 * at all, matching "no filters selected = show everything".
 */
function buildWhereClause(filters: CatalogFilters): { clause: string; params: (string | number)[] } {
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (filters.magMin !== undefined) {
    conditions.push("mag >= ?");
    params.push(filters.magMin);
  }
  if (filters.magMax !== undefined) {
    conditions.push("mag <= ?");
    params.push(filters.magMax);
  }
  if (filters.yearMin !== undefined) {
    conditions.push("year >= ?");
    params.push(filters.yearMin);
  }
  if (filters.yearMax !== undefined) {
    conditions.push("year <= ?");
    params.push(filters.yearMax);
  }
  if (filters.sources && filters.sources.length > 0) {
    const placeholders = filters.sources.map(() => "?").join(", ");
    conditions.push(`source_catalog IN (${placeholders})`);
    params.push(...filters.sources);
  }

  if (conditions.length === 0) {
    return { clause: "", params: [] };
  }
  return { clause: ` WHERE ${conditions.join(" AND ")}`, params };
}

/** Newest-first page of matching rows (`LIMIT`/`OFFSET`), same
 * newest-first convention `features/historical` already uses for its
 * curated list — the most scientifically/publicly interesting default
 * ordering for a general-purpose browse, and stable across pages since
 * `time` is unique-ish and indexed (build script's `idx_events_time`). */
export function buildCatalogPageQuery(
  filters: CatalogFilters,
  limit: number,
  offset: number,
): BuiltQuery {
  const { clause, params } = buildWhereClause(filters);
  return {
    sql: `SELECT ${EVENTS_COLUMNS} FROM events${clause} ORDER BY time DESC LIMIT ? OFFSET ?`,
    params: [...params, limit, offset],
  };
}

/** Total matching-row count for the same filters, used for the results
 * count line and to know when `hasMore` paging should stop. */
export function buildCatalogCountQuery(filters: CatalogFilters): BuiltQuery {
  const { clause, params } = buildWhereClause(filters);
  return {
    sql: `SELECT COUNT(*) AS count FROM events${clause}`,
    params,
  };
}

/** The bundled catalog's own min/max magnitude and year, used to seed the
 * filter UI's stepper bounds from the real data rather than a hardcoded
 * guess (see `config.ts`'s doc comment). */
export function buildCatalogBoundsQuery(): BuiltQuery {
  return {
    sql: "SELECT MIN(mag) AS magMin, MAX(mag) AS magMax, MIN(year) AS yearMin, MAX(year) AS yearMax FROM events",
    params: [],
  };
}
