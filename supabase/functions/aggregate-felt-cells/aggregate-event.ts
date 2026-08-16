// Per-event orchestration: resolve reports -> cells (p4/p5/p6), run the
// vendored `aggregateCell` per cell, diff against the latest stored version,
// and return the set of rows that need writing. No network I/O here —
// `db.ts` owns that — so this module's decision logic (grouping, the
// >=20-report p6 trigger, the idempotent skip-if-unchanged compare) is
// plain, testable TypeScript.

import { aggregateCell, encodeGeohash } from "./felt-aggregation/index.ts";
import type { AggregationInputReport } from "./felt-aggregation/types.ts";
import { computeDamageDist, computeGroundEffectsDist } from "./cell-extras.ts";
import type { CellReport, FeltCellInsertRow, FeltReportDetailRow, FeltReportRow } from "./types.ts";

/** felt-report-science-v1.md §3.1 (D18 R12): p6 city refinement is computed
 * ADDITIONALLY when a p5 cell holds >= 20 reports — it never replaces the
 * p5 row. */
const P6_REFINEMENT_THRESHOLD = 20;

/** felt-report-science-v1.md §3.2 step 5: recompute is debounced >= 60s per
 * event. Applied here as "skip the whole event this invocation if its
 * latest stored cell is younger than this" — cheap insurance against a
 * caller (e.g. a felt_reports INSERT webhook firing once per report during
 * a burst of aftershocks) invoking this function far more often than the
 * science pack intends, on top of the idempotent no-op write below. */
const DEBOUNCE_MS = 60_000;

/**
 * Joins `felt_reports` + `felt_report_details` rows into the per-report
 * shape the rest of this module (and the vendored `aggregateCell`) works
 * with. A report with no matching detail row is tier-1-only.
 */
export function joinReportsAndDetails(
  reports: readonly FeltReportRow[],
  details: readonly FeltReportDetailRow[],
): CellReport[] {
  const detailsByReportId = new Map(details.map((d) => [d.felt_report_id, d]));
  return reports.map((report) => {
    const detail = detailsByReportId.get(report.report_id);
    const base = {
      reportId: report.report_id,
      deviceId: report.device_id,
      lat: report.lat,
      lon: report.lon,
      geohashP5: report.geohash_p5,
      cartoonLevel: report.cartoon_level,
    };
    if (!detail) {
      return { ...base, tier: "tier1" as const };
    }
    return {
      ...base,
      tier: "tier2" as const,
      answers: {
        situation: detail.situation as never,
        felt: detail.felt_answer as never,
        othersFelt: detail.others_felt_answer as never,
        motion: detail.motion_answer as never,
        reaction: detail.reaction_answer as never,
        stand: detail.stand_answer as never,
        shelf: detail.shelf_answer as never,
        picture: detail.picture_answer as never,
        furniture: detail.furniture_answer as never,
        buildingDamageLevel: detail.building_damage_level as never,
        damageTypology: detail.damage_typology as never,
        roadDamageLevel: detail.road_damage_level as never,
        comment: null, // never part of the CDI/damage math — not fetched above
      },
    };
  });
}

function toAggregationInput(report: CellReport): AggregationInputReport {
  if (report.tier === "tier1") {
    return { tier: "tier1", deviceId: report.deviceId, cartoonLevel: report.cartoonLevel };
  }
  return {
    tier: "tier2",
    deviceId: report.deviceId,
    answers: report.answers,
    cartoonLevel: report.cartoonLevel,
  };
}

/** One (geohash, precision) cell's worth of already-grouped reports, ready
 * to run through `aggregateCell` + the local damage/ground-effects
 * extras. */
export interface CellGroup {
  geohash: string;
  precision: 4 | 5 | 6;
  reports: CellReport[];
}

/**
 * Groups an event's reports into every cell that needs a `felt_cells` row:
 * one p4 rollup per 4-char geohash prefix, one p5 row per 5-char geohash
 * (the base display/CDI cell), and p6 refinement rows for any p5 cell whose
 * REPORT COUNT (pre-dedup, matching how `aggregateCell` itself dedupes
 * internally — see its own `dedupeByDevice` doc) reaches the >=20 trigger.
 */
export function groupIntoCells(reports: readonly CellReport[]): CellGroup[] {
  const byP5 = new Map<string, CellReport[]>();
  const byP4 = new Map<string, CellReport[]>();

  for (const report of reports) {
    const p5 = report.geohashP5;
    const p4 = p5.slice(0, 4);
    (byP5.get(p5) ?? byP5.set(p5, []).get(p5)!).push(report);
    (byP4.get(p4) ?? byP4.set(p4, []).get(p4)!).push(report);
  }

  const groups: CellGroup[] = [];

  for (const [geohash, groupReports] of byP4) {
    groups.push({ geohash, precision: 4, reports: groupReports });
  }

  for (const [geohash, groupReports] of byP5) {
    groups.push({ geohash, precision: 5, reports: groupReports });

    if (groupReports.length >= P6_REFINEMENT_THRESHOLD) {
      const byP6 = new Map<string, CellReport[]>();
      for (const report of groupReports) {
        const p6 = encodeGeohash(report.lat, report.lon, 6);
        (byP6.get(p6) ?? byP6.set(p6, []).get(p6)!).push(report);
      }
      for (const [p6Geohash, p6Reports] of byP6) {
        groups.push({ geohash: p6Geohash, precision: 6, reports: p6Reports });
      }
    }
  }

  return groups;
}

/** Runs the vendored CDI math + the local extras for one cell group. Returns
 * `null` if the group somehow aggregates to zero reports (defensive only —
 * every group here came from a non-empty `reports` array, so this should be
 * unreachable, but `aggregateCell` itself models an empty result rather
 * than assuming, so this function respects that same discipline). */
export function computeCellRow(
  eventId: string,
  group: CellGroup,
  version: number,
): FeltCellInsertRow | null {
  const outcome = aggregateCell(group.reports.map(toAggregationInput));
  if (!outcome.ok) {
    return null;
  }
  const tier2Reports = group.reports.filter((r): r is Extract<CellReport, { tier: "tier2" }> =>
    r.tier === "tier2",
  );
  return {
    event_id: eventId,
    geohash: group.geohash,
    precision: group.precision,
    n_reports: outcome.cell.nReports,
    n_tier2: outcome.cell.nTier2,
    cdi: outcome.cell.cdi,
    cws: outcome.cell.cws,
    index_means: outcome.cell.indexMeans,
    damage_dist: computeDamageDist(tier2Reports) as unknown as Record<string, unknown>,
    ground_effects: computeGroundEffectsDist(tier2Reports) as unknown as Record<string, unknown>,
    version,
  };
}

/** Canonical (key-sorted) JSON serialization — used to compare a freshly
 * computed cell row against the latest stored version regardless of object
 * key insertion order, which is not semantically meaningful for either
 * `index_means`/`damage_dist`/`ground_effects` (plain data bags) or the row
 * comparison itself. */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, val) => {
    if (val && typeof val === "object" && !Array.isArray(val)) {
      return Object.keys(val as Record<string, unknown>)
        .sort()
        .reduce<Record<string, unknown>>((sorted, k) => {
          sorted[k] = (val as Record<string, unknown>)[k];
          return sorted;
        }, {});
    }
    return val;
  });
}

const COMPARABLE_FIELDS = [
  "n_reports",
  "n_tier2",
  "cdi",
  "cws",
  "index_means",
  "damage_dist",
  "ground_effects",
] as const;

/** True when `computed` has identical CONTENT to `existing` — ignoring
 * `version`/`computed_at`/`event_id`/`geohash`/`precision` (the identity
 * fields, which the caller already matched to find `existing` in the first
 * place). This is the idempotency mechanism: replaying the exact same input
 * produces a row that compares equal here, so no new version is written —
 * "replaying ingestion... causes no duplicates" for this function. */
export function cellRowUnchanged(
  computed: FeltCellInsertRow,
  existing: FeltCellInsertRow | undefined,
): boolean {
  if (!existing) {
    return false;
  }
  return COMPARABLE_FIELDS.every(
    (field) => canonicalJson(computed[field]) === canonicalJson(existing[field]),
  );
}

/** Picks the latest (highest-version) stored row per geohash from a flat
 * list spanning every version of every cell for an event (`db.ts`'s
 * `fetchAllCellVersionsForEvent`, already ordered `version desc`). */
export function pickLatestPerGeohash(
  rows: readonly (FeltCellInsertRow & { version: number })[],
): Map<string, FeltCellInsertRow & { version: number }> {
  const latest = new Map<string, FeltCellInsertRow & { version: number }>();
  for (const row of rows) {
    if (!latest.has(row.geohash)) {
      latest.set(row.geohash, row);
    }
  }
  return latest;
}

/** The >=60s debounce (science pack §3.2 step 5) — `latestComputedAt` is
 * the most recent `computed_at` across every stored cell for the event
 * (`null` when the event has no cells yet, which never debounces). */
export function isDebounced(latestComputedAt: string | null, now: number = Date.now()): boolean {
  if (!latestComputedAt) {
    return false;
  }
  return now - new Date(latestComputedAt).getTime() < DEBOUNCE_MS;
}
