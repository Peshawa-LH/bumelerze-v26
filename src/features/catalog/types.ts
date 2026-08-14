/**
 * Regional Catalog browser (regional-catalog wave) — types mirror the
 * `events` table columns produced by
 * `shake-service/scripts/build_regional_catalog.py` (see that script's
 * module docstring for the merge/dedup algorithm and
 * `shake-service/regional-catalog/BUILD_REPORT.md` for per-source counts
 * and data-quality notes). These are archival, already-merged events —
 * unlike `features/events` (the live USGS feed), there is no provider
 * fetch here, only local SQL against the bundled, read-only database.
 */

/** The five source catalogs merged into `bumelerze-catalog.sqlite`, in the
 * same canonical-parameter priority order used by the build script
 * (highest first). Kept as a literal union (not a free string) so filter
 * UI and i18n source labels can't silently drift from what the db
 * actually contains. */
export const CATALOG_SOURCES = ["ISCGEM", "ONUR2017", "EMME", "USGS", "KISC"] as const;
export type CatalogSource = (typeof CATALOG_SOURCES)[number];

/** The "Bumelerze" chip in the source filter bar. Deliberately NOT a
 * `CatalogSource` and never a `source_catalog` value in the db: Bumelerze
 * is the UNION view — the deduplicated compilation itself, i.e. every row
 * regardless of which source supplied its canonical record — not a row
 * subset. Selecting it means "no per-source constraint" (`sources: []`),
 * which is also the browser's default state; the five real source chips
 * keep filtering to subsets exactly as before. */
export const CATALOG_UNION_CHIP = "BUMELERZE" as const;

/** One row of the `events` table, camelCased at the SQL layer (see
 * `query-builder.ts`'s `SELECT ... AS`) so no separate JS-side mapping
 * step is needed between the db row shape and this type. */
export interface CatalogRow {
  id: string;
  /** Canonical Bumelerze event id (`bml` + 4-digit year + base-36 per-year
   * counter, e.g. `bml2017000s` = the 2017 Halabja mainshock), assigned
   * retroactively by the catalog build — scheme:
   * `shake-service/shake_service/event_id.py` /
   * `docs/research/bumelerze-id-scheme.md`. Shown ONLY in the catalog
   * detail sheet (archival/internal context) — deliberately not surfaced
   * anywhere else in the app. */
  bumelerzeId: string;
  /** ISO8601 UTC, e.g. "2017-11-12T18:18:17.180Z". */
  time: string;
  year: number;
  lat: number;
  lon: number;
  depthKm: number | null;
  mag: number;
  magType: string;
  sourceCatalog: CatalogSource;
  sourceId: string | null;
  /** Comma-joined list of every source that contributed a merged record
   * (build script's `contributing_sources` column) — provenance context
   * for the detail sheet, distinct from `sourceCatalog` (the single
   * highest-priority/canonical source). */
  contributingSources: string;
  mergedCount: number;
}

/** All filters optional/undefined = "no constraint on this field". An
 * empty `sources` array is treated the same as `undefined` (no source
 * constraint) by `query-builder.ts` — both mean "all sources", matching
 * the filter UI's "no chips selected = show everything" default. */
export interface CatalogFilters {
  magMin?: number;
  magMax?: number;
  yearMin?: number;
  yearMax?: number;
  sources?: readonly CatalogSource[];
}

/** The full min/max span of the bundled catalog, read once from the db
 * itself (`fetchCatalogBounds`) rather than hardcoded — the filter UI
 * initializes its steppers from this so the range shown always matches
 * whatever `bumelerze-catalog.sqlite` actually contains, even if a future
 * rebuild changes it. */
export interface CatalogBounds {
  magMin: number;
  magMax: number;
  yearMin: number;
  yearMax: number;
}
