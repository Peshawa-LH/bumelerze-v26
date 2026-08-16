import { selectFeltMapCells } from "../cell-selection";
import type { FeltCellRow } from "../types";

function row(overrides: Partial<FeltCellRow> & Pick<FeltCellRow, "geohash" | "precision">): FeltCellRow {
  return {
    event_id: "us2000bmcg",
    n_reports: 10,
    n_tier2: 3,
    cdi: 4.5,
    version: 1,
    computed_at: "2026-08-14T02:00:00.000Z",
    ...overrides,
  };
}

describe("selectFeltMapCells", () => {
  it("keeps a lone p5 cell as-is", () => {
    const cells = selectFeltMapCells([row({ geohash: "tn263", precision: 5 })]);
    expect(cells.map((c) => c.geohash)).toEqual(["tn263"]);
  });

  it("drops a p5 parent that has a p6 child refinement present (finest-precision-wins)", () => {
    const cells = selectFeltMapCells([
      row({ geohash: "tn263", precision: 5 }),
      row({ geohash: "tn263c", precision: 6 }),
    ]);
    expect(cells.map((c) => c.geohash)).toEqual(["tn263c"]);
  });

  it("drops a p4 rollup that has p5 descendants present, keeping only the p5s", () => {
    const cells = selectFeltMapCells([
      row({ geohash: "tn26", precision: 4 }),
      row({ geohash: "tn263", precision: 5 }),
      row({ geohash: "tn264", precision: 5 }),
    ]);
    expect(cells.map((c) => c.geohash).sort()).toEqual(["tn263", "tn264"]);
  });

  it("keeps a p4 rollup that has no finer descendant covering it", () => {
    const cells = selectFeltMapCells([
      row({ geohash: "tn26", precision: 4 }),
      row({ geohash: "tn27", precision: 4 }), // sibling, not a descendant
    ]);
    expect(cells.map((c) => c.geohash).sort()).toEqual(["tn26", "tn27"]);
  });

  it("does not treat two unrelated same-length geohashes as nested", () => {
    const cells = selectFeltMapCells([
      row({ geohash: "tn263", precision: 5 }),
      row({ geohash: "tn264", precision: 5 }),
    ]);
    expect(cells).toHaveLength(2);
  });

  it("drops cells with a null cdi (nothing to color them with)", () => {
    const cells = selectFeltMapCells([
      row({ geohash: "tn263", precision: 5, cdi: null }),
      row({ geohash: "tn264", precision: 5, cdi: 5.0 }),
    ]);
    expect(cells.map((c) => c.geohash)).toEqual(["tn264"]);
  });

  it("sorts the output by geohash for deterministic rendering order", () => {
    const cells = selectFeltMapCells([
      row({ geohash: "tn264", precision: 5 }),
      row({ geohash: "tn263", precision: 5 }),
      row({ geohash: "tn261", precision: 5 }),
    ]);
    expect(cells.map((c) => c.geohash)).toEqual(["tn261", "tn263", "tn264"]);
  });

  it("returns an empty array for an empty input", () => {
    expect(selectFeltMapCells([])).toEqual([]);
  });
});
