// VENDORED — hand-synced copy of `src/lib/felt-aggregation/types.ts`.
// See `answer-types.ts` in this folder for why this copy exists and how it
// is kept honest (the jest golden-fixture sync test,
// `src/lib/felt-aggregation/__tests__/vendored-sync.test.ts`). Only
// mechanical differences from the source file: the `@/features/felt/types`
// import is replaced by the local `./answer-types.ts`, and relative imports
// carry Deno-required `.ts` extensions. No type/logic changes.

import type {
  CartoonLevel,
  DamageLevel,
  Tier2Answers,
} from "./answer-types.ts";

export type { CartoonLevel, DamageLevel, Tier2Answers };

// ---------------------------------------------------------------------------
// Input: one report per device, already resolved to a single event+cell.
// Cell/event assignment (which geohash, which event_id) happens upstream —
// this module only aggregates a pre-filtered list of reports that belong to
// one (event, cell).
// ---------------------------------------------------------------------------

interface AggregationInputReportBase {
  /** Dedup key (felt-report-science-v1.md §3.2 step 1: "one report per
   * device ID per event"). Opaque string — this module does not care how
   * it was derived (`device-id.ts`'s installation UUID upstream). */
  deviceId: string;
}

export interface Tier1InputReport extends AggregationInputReportBase {
  tier: "tier1";
  cartoonLevel: CartoonLevel;
}

export interface Tier2InputReport extends AggregationInputReportBase {
  tier: "tier2";
  answers: Tier2Answers;
  /**
   * The tier-1 cartoon pick this tier-2 submission superseded, if the
   * caller has it (§3.3: "every tier-2 user also made a tier-1 pick").
   * Optional and NOT used by the §3.2/§3.3 CDI math (tier-2 supersedes,
   * never adds to, its own tier-1 record) — the only consumer is the R14
   * corroboration-gate evidence count in `cell-aggregation.ts`.
   */
  cartoonLevel?: CartoonLevel;
}

/** Discriminated union — one report, either tier. */
export type AggregationInputReport = Tier1InputReport | Tier2InputReport;

// ---------------------------------------------------------------------------
// Output: mirrors `felt_cells` (supabase/migrations/0004_felt_cells.sql).
// `event_id`, `geohash`, `precision`, `version`, `computed_at`, and the
// IMS-25/EMS columns are left to the caller (this module computes the CDI
// path only — see README "what is deliberately NOT here").
// ---------------------------------------------------------------------------

/** The 8 published DYFI/CDI indices (felt-report-science-v1.md §2.1) —
 * per-cell consensus MEAN over answering reports, `null` when zero reports
 * answered that question (never zero-counted; §3.2 step 1). */
export interface IndexMeans {
  felt: number | null;
  motion: number | null;
  reaction: number | null;
  stand: number | null;
  shelf: number | null;
  picture: number | null;
  furniture: number | null;
  damage: number | null;
}

export interface FeltCellAggregate {
  nReports: number;
  nTier2: number;

  /** Final cell intensity: §3.2 CDI when tier-2-only, §3.3 count-weighted
   * combination when mixed/tier-1-only — floor 2.0 / cap 9.0 / round 0.1
   * already applied. */
  cdi: number | null;

  /** Community Weighted Sum feeding the CDI log formula (§3.2 steps 2-3).
   * `null` when the cell has no tier-2 reports (pure tier-1 cartoon path,
   * §3.3, has no CWS concept). */
  cws: number | null;

  /** Full audit trail — the 8 consensus means (§3.2 step 1, §3.5). */
  indexMeans: IndexMeans;

  /** §3.2 step 4: the *public display* threshold — n_reports >= 3. Mirrors
   * `felt_cells_public`'s `WHERE fc.n_reports >= 3` (0004_felt_cells.sql). */
  meetsDisplayThreshold: boolean;

  /** §1.2 point 2 / D18 R14: the corroboration gate. Equal to `cdi` when
   * the gate passes (or doesn't apply) and `meetsDisplayThreshold` is true;
   * `null` otherwise. */
  displayIntensity: number | null;

  /** Whether the R14 gate passed (always `true` when no >=8-level evidence
   * is present — the gate only ever restricts, never inflates). */
  corroborationGatePassed: boolean;
}

/** Result-style outcome — `aggregateCell` is only ever asked to aggregate a
 * non-empty report list in practice, but an empty input is a real
 * possibility (e.g. a cell whose only reports were all later retracted), so
 * it is modelled, not thrown. */
export type AggregateCellOutcome =
  | { ok: true; cell: FeltCellAggregate }
  | { ok: false; reason: "no_reports" };
