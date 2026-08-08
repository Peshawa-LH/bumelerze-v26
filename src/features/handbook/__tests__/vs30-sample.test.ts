import { sampleVs30 } from "../vs30-sample";
import { VS30_GRID } from "../data";
import type { Vs30Grid } from "../types";

// A tiny synthetic 3x3 grid, 1-degree cells, origin (top-left corner) at
// (0, 3): cell centers therefore sit at lon 0.5/1.5/2.5, lat 2.5/1.5/0.5
// (row 0 = north-most, matching the real grid's GDAL geotransform
// convention — dLat is negative).
const GRID: Vs30Grid = {
  originLon: 0,
  originLat: 3,
  dLon: 1,
  dLat: -1,
  cols: 3,
  rows: 3,
  nodata: -9999,
  citation: "test citation",
  values: [
    100,
    200,
    300, // row 0 (lat ~2.5)
    400,
    500,
    600, // row 1 (lat ~1.5)
    700,
    800,
    900, // row 2 (lat ~0.5)
  ],
};

describe("sampleVs30", () => {
  it("returns the exact cell value at a cell center", () => {
    expect(sampleVs30(GRID, 1.5, 1.5)).toBe(500);
  });

  it("bilinearly interpolates between four cell centers", () => {
    // Midpoint between (row0,col0)=100 and (row0,col1)=200 centers.
    expect(sampleVs30(GRID, 2.5, 1.0)).toBeCloseTo(150, 5);
    // Midpoint of all four centers around the grid's core.
    expect(sampleVs30(GRID, 2.0, 1.0)).toBeCloseTo((100 + 200 + 400 + 500) / 4, 5);
  });

  it("clamps to the nearest edge cell just outside the cell-center envelope but inside the footprint", () => {
    // Grid footprint extends half a cell beyond the outermost centers
    // (to the pixel corners) — a point right at the top-left pixel corner
    // (lon 0, lat 3) should clamp to the corner cell's own value, not null.
    expect(sampleVs30(GRID, 3, 0)).toBe(100);
  });

  it("returns null well outside the grid's bundled footprint", () => {
    expect(sampleVs30(GRID, 50, 50)).toBeNull();
    expect(sampleVs30(GRID, -50, -50)).toBeNull();
  });

  it("falls back to nearest-neighbor when some but not all of the 4 surrounding cells are nodata", () => {
    const partialGrid: Vs30Grid = {
      ...GRID,
      values: [100, 200, 300, 400, -9999, 600, 700, 800, 900],
    };
    // Query right at the nodata cell's center — bilinear would need all 4
    // neighbors (itself included via the surrounding cell math), so this
    // exercises the partial-coverage fallback path.
    const result = sampleVs30(partialGrid, 1.5, 1.5);
    expect(result).not.toBeNull();
    expect(result).not.toBe(-9999);
  });

  it("returns null when every surrounding cell is nodata", () => {
    const allNodata: Vs30Grid = { ...GRID, values: GRID.values.map(() => -9999) };
    expect(sampleVs30(allNodata, 1.5, 1.5)).toBeNull();
  });
});

describe("sampleVs30 against the real bundled Iraq grid", () => {
  it("returns a value within the source raster's known range for Sulaimani", () => {
    const value = sampleVs30(VS30_GRID, 35.56, 45.43);
    expect(value).not.toBeNull();
    expect(value as number).toBeGreaterThanOrEqual(150);
    expect(value as number).toBeLessThanOrEqual(950);
  });

  it("returns null far outside the grid's footprint (e.g. Paris) — outside-Iraq state", () => {
    expect(sampleVs30(VS30_GRID, 48.8566, 2.3522)).toBeNull();
  });
});
