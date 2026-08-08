import type { Vs30Grid } from "./types";

function cellValue(grid: Vs30Grid, row: number, col: number): number {
  const clampedRow = Math.min(Math.max(row, 0), grid.rows - 1);
  const clampedCol = Math.min(Math.max(col, 0), grid.cols - 1);
  // Row-major flat array — always in-bounds after clamping above, so the
  // `?? grid.nodata` fallback exists only to satisfy `noUncheckedIndexedAccess`.
  return grid.values[clampedRow * grid.cols + clampedCol] ?? grid.nodata;
}

/**
 * Bilinearly samples the bundled Vs30 grid at `(lat, lon)`. `originLon`/
 * `originLat` are the grid's top-left PIXEL CORNER (GDAL geotransform
 * convention, matches `build_handbook_data.py`'s `gt[0]`/`gt[3]`) — cell
 * CENTERS sit half a step inward, which is what the `- 0.5` below accounts
 * for. `dLat` is negative (row index increases going south), so both the
 * row math and the "is this point inside the grid's footprint at all" check
 * below use it as-is rather than assuming a positive step.
 *
 * Returns `null` when:
 * - the point falls entirely outside the grid's bundled footprint (roughly
 *   all of Iraq — points outside Iraq return null here), or
 * - every one of the 4 surrounding cells is the raster's "outside the
 *   source clip" nodata sentinel.
 *
 * Falls back from bilinear to single-cell nearest-neighbor when SOME (not
 * all) of the 4 surrounding cells are nodata — this only matters within one
 * grid cell (~5.5 km) of the Iraq clip boundary, and a coarse nearest value
 * there is still more useful to an engineer than silently returning null a
 * few km inside the country.
 */
export function sampleVs30(grid: Vs30Grid, lat: number, lon: number): number | null {
  const fx = (lon - grid.originLon) / grid.dLon - 0.5;
  const fy = (lat - grid.originLat) / grid.dLat - 0.5;

  const withinFootprint =
    fx >= -0.5 && fx <= grid.cols - 0.5 && fy >= -0.5 && fy <= grid.rows - 0.5;
  if (!withinFootprint) {
    return null;
  }

  const col0 = Math.floor(fx);
  const row0 = Math.floor(fy);
  const wx = fx - col0;
  const wy = fy - row0;

  const v00 = cellValue(grid, row0, col0);
  const v10 = cellValue(grid, row0, col0 + 1);
  const v01 = cellValue(grid, row0 + 1, col0);
  const v11 = cellValue(grid, row0 + 1, col0 + 1);

  const corners = [v00, v10, v01, v11];
  const validCorners = corners.filter((v) => v !== grid.nodata);

  if (validCorners.length === 4) {
    const top = v00 * (1 - wx) + v10 * wx;
    const bottom = v01 * (1 - wx) + v11 * wx;
    return top * (1 - wy) + bottom * wy;
  }

  if (validCorners.length === 0) {
    return null;
  }

  // Partial coverage near the clip boundary: fall back to the nearest of
  // the 4 corners (by fractional distance) that actually has data.
  const candidates: { value: number; distance: number }[] = [];
  if (v00 !== grid.nodata) candidates.push({ value: v00, distance: wx ** 2 + wy ** 2 });
  if (v10 !== grid.nodata)
    candidates.push({ value: v10, distance: (1 - wx) ** 2 + wy ** 2 });
  if (v01 !== grid.nodata)
    candidates.push({ value: v01, distance: wx ** 2 + (1 - wy) ** 2 });
  if (v11 !== grid.nodata)
    candidates.push({ value: v11, distance: (1 - wx) ** 2 + (1 - wy) ** 2 });
  candidates.sort((a, b) => a.distance - b.distance);
  return candidates[0]?.value ?? null;
}
