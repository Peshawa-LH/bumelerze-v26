// Local (non-vendored) types for this function's own DB-row shapes and
// per-cell report bookkeeping. `felt-aggregation/` stays exactly what
// `src/lib/felt-aggregation/` is — these types are the "caller adapts raw
// rows into AggregationInputReport shapes" layer the source lib's own
// `types.ts` doc comment describes as its callers' job.

import type { CartoonLevel, Tier2Answers } from "./felt-aggregation/answer-types.ts";
import type { IndexMeans } from "./felt-aggregation/types.ts";

export interface CellReportBase {
  reportId: string;
  deviceId: string;
  lat: number;
  lon: number;
  /** `felt_reports.geohash_p5` — read straight off the row (it's a
   * `GENERATED ALWAYS AS ... STORED` column, computed server-side at
   * insert time), never recomputed here. p4 is derived from this by
   * string-prefix truncation (geohash is prefix-hierarchical: the first N
   * characters of a precision-M geohash, M>=N, equal the precision-N
   * geohash for the same point) — only p6 needs a fresh `encodeGeohash`
   * call, since extending precision requires the actual lat/lon. */
  geohashP5: string;
  /** `felt_reports.cartoon_level` — present on EVERY report, tier-1 or
   * tier-2: tier-2 submission supersedes the device's tier-1 pick in
   * `felt_report_details` (D18 §3.2), it does not overwrite or clear
   * `felt_reports.cartoon_level` itself. Feeds `Tier2InputReport
   * .cartoonLevel` for tier-2 rows (the R14 corroboration-gate evidence
   * count — see that field's own doc in `felt-aggregation/types.ts`). */
  cartoonLevel: CartoonLevel;
}

export interface Tier1CellReport extends CellReportBase {
  tier: "tier1";
}

export interface Tier2CellReport extends CellReportBase {
  tier: "tier2";
  answers: Tier2Answers;
}

export type CellReport = Tier1CellReport | Tier2CellReport;

/** Row shape read from `felt_reports` (only the columns this function
 * needs — migration 0003). */
export interface FeltReportRow {
  report_id: string;
  device_id: string;
  event_id: string;
  cartoon_level: CartoonLevel;
  lat: number;
  lon: number;
  geohash_p5: string;
}

/** Row shape read from `felt_report_details` (only the columns this
 * function needs — migration 0003, extended by 0009). */
export interface FeltReportDetailRow {
  felt_report_id: string;
  situation: string | null;
  felt_answer: string | null;
  others_felt_answer: string | null;
  motion_answer: string | null;
  reaction_answer: string | null;
  stand_answer: string | null;
  shelf_answer: string | null;
  picture_answer: string | null;
  furniture_answer: string | null;
  building_damage_level: number | null;
  damage_typology: string | null;
  road_damage_level: number | null;
}

/** Row shape written to `felt_cells` (migration 0004). `ems_int`/
 * `ems_range`/`ems_method` are always null — the parallel IMS-25 path is
 * explicit Phase-2 server work (felt-report-science-v1.md §3.4.5), not
 * this function's job (same "deliberately NOT here" boundary the source
 * lib's own README documents). */
export interface FeltCellInsertRow {
  event_id: string;
  geohash: string;
  precision: 4 | 5 | 6;
  n_reports: number;
  n_tier2: number;
  cdi: number | null;
  cws: number | null;
  index_means: IndexMeans;
  damage_dist: Record<string, unknown>;
  ground_effects: Record<string, unknown>;
  version: number;
}
