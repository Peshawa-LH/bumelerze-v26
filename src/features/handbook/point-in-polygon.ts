import type { PgaZone } from "./types";

/**
 * Standard ray-casting point-in-polygon test (even-odd rule) against a
 * closed `[lon, lat]` ring. Pure/stateless so it's trivially unit-testable;
 * operates on plain rings rather than a specific zone type so it can be
 * reused if a second polygon dataset joins the handbook later.
 */
export function pointInRing(lat: number, lon: number, ring: readonly (readonly [number, number])[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const pi = ring[i];
    const pj = ring[j];
    if (!pi || !pj) {
      continue;
    }
    const [xi, yi] = pi;
    const [xj, yj] = pj;
    const intersects =
      yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersects) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Finds the Iraqi Seismic Code 2017 zone containing `(lat, lon)`, or `null`
 * if the point falls outside every bundled zone polygon (spec-v1.md §7:
 * "outside zonation" state honestly — never a nearest-zone guess). Zone VI
 * exists as two disjoint polygons in the source data (see
 * `HANDBOOK_DATA_REPORT.md` §1) — either matching first wins, both carry
 * the same 0.6g value, so which one is irrelevant to the result.
 */
export function lookupPgaZone(
  lat: number,
  lon: number,
  zones: readonly PgaZone[],
): PgaZone | null {
  for (const zone of zones) {
    if (pointInRing(lat, lon, zone.ring)) {
      return zone;
    }
  }
  return null;
}
