import * as fs from "node:fs";
import * as path from "node:path";

import { FELT_CELL_ROW_COLUMNS, parseFeltCellRows } from "../types";

/**
 * Sync-check against the actual migration SQL (same discipline as
 * `features/felt/__tests__/supabase-transport.test.ts`'s column-sync
 * tests): parses `felt_cells_public`'s `create view` select list out of
 * `supabase/migrations/0004_felt_cells.sql` with a plain regex (no SQL
 * parser dependency) and asserts it's IDENTICAL, in order, to
 * `FELT_CELL_ROW_COLUMNS` — the list this module's zod schema and
 * `transport.ts`'s `.select(...)` are both built from. Fails loudly if
 * either the view or the client contract changes without the other.
 */
function loadFeltCellsPublicColumns(): string[] {
  const sqlPath = path.join(
    __dirname,
    "../../../../supabase/migrations/0004_felt_cells.sql",
  );
  const sql = fs.readFileSync(sqlPath, "utf8");

  // Starts AFTER the "distinct on (fc.event_id, fc.geohash)" clause so
  // those two columns' dedup-key mention isn't double-counted against the
  // actual select list right below it.
  const startMarker = "select distinct on (fc.event_id, fc.geohash)";
  const startIdx = sql.indexOf(startMarker);
  const fromIdx = sql.indexOf("from public.felt_cells fc", startIdx);
  if (startIdx === -1 || fromIdx === -1) {
    throw new Error("loadFeltCellsPublicColumns: view definition not found");
  }
  const selectBody = sql.slice(startIdx + startMarker.length, fromIdx);

  const columns: string[] = [];
  for (const match of selectBody.matchAll(/fc\.([a-z_][a-z0-9_]*)/g)) {
    if (match[1]) {
      columns.push(match[1]);
    }
  }
  return columns;
}

describe("felt_cells_public contract sync", () => {
  it("FELT_CELL_ROW_COLUMNS matches the view's select list, in order", () => {
    expect([...FELT_CELL_ROW_COLUMNS]).toEqual(loadFeltCellsPublicColumns());
  });
});

/** A valid `felt_cells_public` row shape — column-for-column against
 * supabase/migrations/0004_felt_cells.sql's view definition. PostgREST
 * returns `numeric` columns as strings, which is exercised explicitly
 * below (the "coerces numeric string cdi" case) rather than assumed. */
function validRow(overrides: Record<string, unknown> = {}) {
  return {
    event_id: "us2000bmcg",
    geohash: "tn263",
    precision: 5,
    n_reports: 12,
    n_tier2: 4,
    cdi: 4.5,
    version: 1,
    computed_at: "2026-08-14T02:00:00.000Z",
    ...overrides,
  };
}

describe("parseFeltCellRows", () => {
  it("parses a well-formed row list with zero skips", () => {
    const { rows, skippedCount } = parseFeltCellRows([validRow(), validRow({ geohash: "tn264" })]);
    expect(rows).toHaveLength(2);
    expect(skippedCount).toBe(0);
  });

  it("coerces a PostgREST numeric-string cdi to a number", () => {
    const { rows } = parseFeltCellRows([validRow({ cdi: "4.5" })]);
    expect(rows[0]?.cdi).toBe(4.5);
  });

  it("accepts a null cdi (nullable per the base table's schema)", () => {
    const { rows } = parseFeltCellRows([validRow({ cdi: null })]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.cdi).toBeNull();
  });

  it("accepts precision 4, 5, and 6", () => {
    const { rows, skippedCount } = parseFeltCellRows([
      validRow({ precision: 4, geohash: "tn26" }),
      validRow({ precision: 5, geohash: "tn263" }),
      validRow({ precision: 6, geohash: "tn263c" }),
    ]);
    expect(rows).toHaveLength(3);
    expect(skippedCount).toBe(0);
  });

  it("rejects an out-of-domain precision (7) and counts it as skipped", () => {
    const { rows, skippedCount } = parseFeltCellRows([validRow({ precision: 7 })]);
    expect(rows).toHaveLength(0);
    expect(skippedCount).toBe(1);
  });

  it("rejects a negative n_reports and counts it as skipped, without dropping other valid rows", () => {
    const { rows, skippedCount } = parseFeltCellRows([
      validRow({ n_reports: -1 }),
      validRow({ geohash: "tn264" }),
    ]);
    expect(rows).toHaveLength(1);
    expect(skippedCount).toBe(1);
  });

  it("rejects a row missing a required column", () => {
    const { rows: valid } = parseFeltCellRows([validRow()]);
    expect(valid).toHaveLength(1);

    const malformed = validRow() as Record<string, unknown>;
    delete malformed.event_id;
    const { rows, skippedCount } = parseFeltCellRows([malformed]);
    expect(rows).toHaveLength(0);
    expect(skippedCount).toBe(1);
  });

  it("returns empty for non-array input rather than throwing", () => {
    expect(parseFeltCellRows(null)).toEqual({ rows: [], skippedCount: 0 });
    expect(parseFeltCellRows(undefined)).toEqual({ rows: [], skippedCount: 0 });
    expect(parseFeltCellRows({ not: "an array" })).toEqual({ rows: [], skippedCount: 0 });
  });
});
