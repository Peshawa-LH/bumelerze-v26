import { z } from "zod";

/**
 * Row contract for `public.felt_cells_public`
 * (supabase/migrations/0004_felt_cells.sql) — the ONLY felt-cell surface
 * this app is allowed to read (the base `felt_cells` table has no
 * anon/authenticated SELECT policy at all; see that migration's RLS
 * section). The view already enforces the >=3-report display threshold and
 * returns only the latest `version` per `(event_id, geohash)`, so nothing
 * client-side needs to re-derive either of those — this schema is
 * deliberately just a typed mirror of the view's own column list, in the
 * same order as the `select` in `supabase-transport.ts`'s sibling
 * `felt_reports`/`felt_report_details` mappers.
 *
 * Deliberately NOT here (matches the view's own omissions, migration 0004's
 * doc comment: "CDI only — no EMS/IMS fields, expert/beta-only"):
 * `ems_int`, `ems_range`, `ems_method`, `index_means`, `cws`, `damage_dist`,
 * `ground_effects` — none of those columns exist on the public view at all.
 */
/** Column list, in the view's own select order — the single source of
 * truth both the zod schema below and `transport.ts`'s `.select(...)` are
 * built from, and what `__tests__/types.test.ts`'s migration-sync check
 * compares against the actual `create view` SQL, so the two can never
 * silently drift apart (same discipline as `supabase-transport.ts`'s own
 * migration-column sync-check tests). */
export const FELT_CELL_ROW_COLUMNS = [
  "event_id",
  "geohash",
  "precision",
  "n_reports",
  "n_tier2",
  "cdi",
  "version",
  "computed_at",
] as const;

const feltCellRowSchema = z.object({
  event_id: z.string(),
  geohash: z.string().min(1),
  // D18 §3.1: 4 = rural rollup, 5 = base display/CDI precision, 6 = city
  // refinement.
  precision: z.union([z.literal(4), z.literal(5), z.literal(6)]),
  n_reports: z.number().int().nonnegative(),
  n_tier2: z.number().int().nonnegative(),
  // `numeric(3,1)` in Postgres comes back over PostgREST as a decimal
  // string, not a JS number — coerced here (once, at the IO boundary) so
  // every downstream consumer (renderer, sorting, ramp lookup) works with a
  // plain `number | null`. Nullable in the base table's own schema even
  // though the aggregation README calls a null `cdi` "unreachable in
  // practice" for a cell that cleared the display threshold — modeled
  // defensively rather than trusted away; `selectFeltMapCells` (below)
  // drops any row that does come back null, since there is nothing to
  // color it with.
  cdi: z.coerce.number().nullable(),
  version: z.number().int().positive(),
  computed_at: z.string(),
});

export type FeltCellRow = z.infer<typeof feltCellRowSchema>;

export interface ParsedFeltCellRows {
  rows: FeltCellRow[];
  /** Count of rows present in the raw response that failed schema
   * validation and were skipped — same tolerant-parsing bookkeeping
   * convention as `events/usgs.ts`'s `skippedCount` (PROJECT.md gotcha:
   * external/DB-shaped data is never trusted blindly). A `felt_cells_public`
   * row should never actually fail this schema (it's our own view, not a
   * third-party feed), so in practice this stays 0 — the tolerance exists
   * for the same reason it exists everywhere else in this codebase: a
   * schema drift should degrade gracefully, not crash the section. */
  skippedCount: number;
}

/**
 * Tolerant array parse: one malformed row is dropped and counted, not a
 * reason to discard the whole response (no silent catches — repo rule —
 * but also no "one bad row nukes the whole map" behavior either).
 */
export function parseFeltCellRows(data: unknown): ParsedFeltCellRows {
  if (!Array.isArray(data)) {
    return { rows: [], skippedCount: 0 };
  }

  const rows: FeltCellRow[] = [];
  let skippedCount = 0;

  for (const item of data) {
    const result = feltCellRowSchema.safeParse(item);
    if (result.success) {
      rows.push(result.data);
    } else {
      skippedCount += 1;
    }
  }

  return { rows, skippedCount };
}
