import type { FeltCellRow } from "./types";

/**
 * CONTRACT AMBIGUITY (documented, not asked as an open question — D14):
 * `felt_cells_public` can hold rows at THREE different precisions for the
 * same event (0004_felt_cells.sql: p4 rural rollup, p5 base display cell,
 * p6 city refinement "computed additionally when a p5 cell holds >=20
 * reports"). The migration and the felt-aggregation README describe how
 * each precision is computed but never say which one(s) the client should
 * actually draw when more than one covers the same ground — a p6 cell's
 * geohash is always a 6-character superstring of its parent p5 cell's
 * geohash (standard geohash nesting), so a naive "draw every row" renderer
 * would paint an overlapping, misleading duplicate square for any densely-
 * reported area.
 *
 * Resolution used here: draw only the FINEST precision available for any
 * given area — a p5 cell is dropped if any p6 row nests inside it, and a p4
 * cell is dropped if any p5 (or p6) row nests inside it. This is the
 * natural reading of "p6 computed additionally... as a refinement": the
 * refinement is meant to supersede its coarser parent on the map, not sit
 * alongside it. `selectFeltMapCells` also drops any row with a null `cdi`
 * (see `types.ts`'s doc comment on that field) since there's nothing to
 * color it with. Output is sorted by geohash for deterministic rendering
 * order (cell squares don't overlap after this filter, so paint order
 * doesn't matter visually, but a stable order keeps tests/golden output
 * reproducible).
 */
export function selectFeltMapCells(rows: readonly FeltCellRow[]): FeltCellRow[] {
  const withCdi = rows.filter(
    (row): row is FeltCellRow & { cdi: number } => row.cdi !== null,
  );

  const leaves = withCdi.filter(
    (row) =>
      !withCdi.some(
        (other) =>
          other.geohash.length > row.geohash.length &&
          other.geohash.startsWith(row.geohash),
      ),
  );

  return [...leaves].sort((a, b) => a.geohash.localeCompare(b.geohash));
}
