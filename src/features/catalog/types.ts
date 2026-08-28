/**
 * Regional Catalog browser (regional-catalog wave) — types mirror the
 * `events` table columns produced by
 * `bumelerze-engine/scripts/build_regional_catalog.py` (see that script's
 * module docstring for the merge/dedup algorithm and
 * `bumelerze-engine/regional-catalog/BUILD_REPORT.md` for per-source counts
 * and data-quality notes). These are archival, already-merged events —
 * unlike `features/events` (the live USGS feed), there is no provider
 * fetch here, only local SQL against the bundled, read-only database.
 */

/** The six source catalogs merged into `bumelerze-catalog.sqlite`, in the
 * same canonical-parameter priority order used by the build script
 * (highest first). Kept as a literal union (not a free string) so filter
 * UI and i18n source labels can't silently drift from what the db
 * actually contains. `ISC` (the ISC Bulletin, now the largest single
 * source at 150k-row scale) is distinct from `ISCGEM` (the ISC-GEM Global
 * Instrumental Catalogue) — do not conflate the two, the db never does. */
export const CATALOG_SOURCES = ["ISC", "ISCGEM", "ONUR2017", "EMME", "USGS", "KISC"] as const;
export type CatalogSource = (typeof CATALOG_SOURCES)[number];

/** The "Bumelerze" chip in the source filter bar. Deliberately NOT a
 * `CatalogSource` and never a `source_catalog` value in the db: Bumelerze
 * is the UNION view — the deduplicated compilation itself, i.e. every row
 * regardless of which source supplied its canonical record — not a row
 * subset. Selecting it means "no per-source constraint" (`sources: []`),
 * which is also the browser's default state; the real source chips keep
 * filtering to subsets exactly as before. */
export const CATALOG_UNION_CHIP = "BUMELERZE" as const;

/** One row of the `events` table, camelCased at the SQL layer (see
 * `query-builder.ts`'s `SELECT ... AS`) so no separate JS-side mapping
 * step is needed between the db row shape and this type.
 *
 * Schema v3 (`bumelerze-engine/scripts/export_app_catalog.py`, 150,072
 * events, 872-2026): the old 16-char surrogate `id` column is gone —
 * `bumelerzeId` (the db's own primary key, `bumelerze_id`) is now the only
 * identity column, doubling as the FlashList/FlatList key. `time` became
 * epoch SECONDS (`t`) rather than an ISO string; see `format.ts`'s
 * `formatCatalogDateTimeUtc` for the conversion. Negative values are
 * expected and correct — the catalog runs back to the year 872, long
 * before the Unix epoch — and must never be treated as invalid. */
export interface CatalogRow {
  /** Canonical Bumelerze event id (`bml` + 4-digit year + base-36 per-year
   * counter, e.g. `bml2017000s` = the 2017 Halabja mainshock), assigned
   * retroactively by the catalog build — scheme:
   * `bumelerze-engine/shake_service/event_id.py` /
   * `docs/research/bumelerze-id-scheme.md`. Also the db's primary key
   * (`bumelerze_id`) since schema v3. Shown in the catalog detail sheet
   * (archival/internal context) and used as the list's row key —
   * deliberately not surfaced anywhere else in the app. */
  bumelerzeId: string;
  /** Epoch seconds (UTC), the db's `t` column. Negative for pre-1970
   * events (the catalog starts in 872) — that is correct, not a bug. */
  time: number;
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
  /** Reporting/originating agency for the canonical record, new in schema
   * v3. Nullable: not every source populates it. Not yet surfaced in the
   * UI (no wave brief field for it); kept on the row type so a future
   * detail-sheet field is a one-line addition, not a query change. */
  authorAgency: string | null;
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
