/**
 * Engineer's Handbook (spec-v1.md §7, design-brief.md §9) — types mirror
 * the three bundled JSON files `bumelerze-engine/scripts/build_handbook_data.py`
 * produces into `data/` (see that script's module docstring for the
 * extraction/simplification details and `bumelerze-engine/handbook-data/
 * HANDBOOK_DATA_REPORT.md` for per-source counts and the two open
 * licensing/provenance flags). These are archival, bundled, offline-by-
 * construction lookups — like `features/catalog`, there is no network
 * fetch here, only local computation against data shipped in the JS bundle.
 */

/** One Iraqi Seismic Code 2017 design-PGA zone polygon. `ring` is a closed
 * lon/lat ring (first point === last point, as GDAL/OGR exports it) —
 * `[lon, lat]` pair order matches GeoJSON convention, not `[lat, lon]`. */
export interface PgaZone {
  /** Roman-numeral zone label (I-VII) — kept as-is, not translated (a
   * mathematical/cartographic symbol, same convention as the app's decimal
   * point: international, not locale-dependent). */
  zone: string;
  pgaG: number;
  ring: readonly (readonly [number, number])[];
}

/** The downsampled Vs30 grid (0.05°, GDAL `average` resampling — see the
 * build script for why). `dLat` is negative (grid rows go north-to-south,
 * matching the source GeoTIFF's own geotransform convention) — callers
 * must not assume a positive row-to-south step. */
export interface Vs30Grid {
  originLon: number;
  originLat: number;
  dLon: number;
  dLat: number;
  cols: number;
  rows: number;
  nodata: number;
  citation: string;
  values: readonly number[];
}

export type SoilMethod = "hvsr" | "borehole" | "spt-vs" | "dem-vs30";

export interface SoilPoint {
  id: string;
  method: SoilMethod;
  lat: number;
  lon: number;
  ec8: string | null;
  nehrp: string | null;
  /** m/s. Null where the source method produces no Vs numeral at all
   * (boreholes — lithology logs only). Where present, only the `dem-vs30`
   * and `hvsr` (DEM proxy co-located at HV points) methods are true Vs30
   * (30 m average); `spt-vs`'s value is `Vs5` (Vs to 5 m depth) — always
   * label it as an estimate, never as Vs30 outright (see
   * `HANDBOOK_DATA_REPORT.md` §3). */
  vs30EstimateMS: number | null;
}

export interface NearbySoilPoint {
  point: SoilPoint;
  distanceKm: number;
}

/** EC8 (Eurocode 8, EN 1998-1) / NEHRP (ASCE 7) site classes derived from a
 * Vs30 value — see `site-class.ts` for the boundary table and citations. */
export interface SiteClassResult {
  ec8: string;
  nehrp: string;
}

/** One Iraqi Seismic Code 2025 `Ss` zone band, traced from the IMOS-2025
 * map sheet. `ring` is a closed `[lon, lat]` ring, same convention as
 * `PgaZone`, so `pointInRing` serves both. `ssMinG`/`ssMaxG` are the class
 * breaks printed in the sheet's own legend. */
export interface Isc2025SsZone {
  /** Roman-numeral band label (I-V) — kept as-is, not translated, same
   * convention as `PgaZone.zone`. */
  zone: string;
  ssMinG: number;
  ssMaxG: number;
  ring: readonly (readonly [number, number])[];
}

/** One district from the ISC-2025 value table (79 districts, 18
 * governorates). Values are g, at the two published return periods. */
export interface Isc2025District {
  /** The table's own "governorate.district" numbering, e.g. "18.3". */
  id: string;
  nameEn: string;
  nameAr: string;
  governorate: string;
  lat: number;
  lon: number;
  ss2475G: number;
  s12475G: number;
  ss1000G: number;
  s11000G: number;
  /**
   * The table's PGA column — carried for auditability and NEVER to be
   * shown as a ground acceleration or used to derive anything.
   *
   * Across all 79 districts the table holds `Ss = 5 x PGA` and
   * `S1 = 2 x PGA` to within rounding, so this column is a fixed fraction
   * of `Ss` rather than an independent value, and it disagrees with the
   * source study's own PGA by about a factor of two (the study's spectra
   * give a short-period plateau near 2.2x PGA, not 5x). See
   * `bumelerze-engine/scripts/build_isc2025_hazard.py` for the full
   * cross-check. Presenting it would be exactly the "plausible wrong
   * number" failure the withheld `R` table in `spectrum/config.ts` avoids.
   */
  pga2475G: number;
  pga1000G: number;
  /** The band this district's own `Ss` falls in — from the table, not
   * sampled off the map, so it is right even for the handful of districts
   * whose `Ss` sits within 0.03 g of a class break. */
  zone: string;
}

export interface NearestIsc2025DistrictResult {
  district: Isc2025District;
  distanceKm: number;
}

/** Both ISC-2025 answers for a coordinate, deliberately unmerged — see
 * `isc2025.ts` for why interpolating between districts is refused. */
export interface Isc2025Result {
  /** Null when the point falls outside the mapped zonation (outside Iraq,
   * or on the far southern coastal tip the traced bands do not reach) —
   * the spec's honest-empty-state rule, never a nearest-band guess. */
  zone: Isc2025SsZone | null;
  /** Never null in practice (the table spans the whole country), but the
   * distance can be large, and the UI must always show it: a value from a
   * district 80 km away is a weaker claim than one from 3 km away. */
  nearestDistrict: NearestIsc2025DistrictResult | null;
}

export interface HandbookLookupResult {
  lat: number;
  lon: number;
  /** Null = point falls outside every zone polygon ("outside zonation",
   * spec's own honest-empty-state requirement — never a guessed/nearest
   * value). */
  pgaZone: PgaZone | null;
  /** Null = point falls outside the bundled Vs30 grid's coverage (either
   * outside its bounding box, or every surrounding cell is a nodata
   * "outside Iraq clip" cell). */
  vs30MS: number | null;
  vs30Citation: string;
  /** Null whenever `vs30MS` is null — site class is always derived FROM the
   * sampled Vs30, never independently estimated. */
  siteClass: SiteClassResult | null;
  /** Sorted nearest-first; empty (not null) when nothing is within the
   * search radius — the spec's "else section hidden" requirement is a UI
   * concern (`components/HandbookResultTable.tsx`), not a data-shape one. */
  nearbySoilPoints: readonly NearbySoilPoint[];
  /** ISC-2025 design ground motions — the `Ss`/`S1` the spectrum
   * calculator needs, which before this the engineer had to supply by
   * hand. */
  isc2025: Isc2025Result;
}
