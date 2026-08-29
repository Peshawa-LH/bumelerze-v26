import { PGA_ZONES, SOIL_POINTS, VS30_GRID } from "./data";
import { lookupIsc2025 } from "./isc2025";
import { lookupPgaZone } from "./point-in-polygon";
import { siteClassFromVs30 } from "./site-class";
import { nearbySoilPoints } from "./soil-nearest";
import type { HandbookLookupResult } from "./types";
import { sampleVs30 } from "./vs30-sample";

/**
 * The single entry point that turns a coordinate pair into every cited row
 * the handbook screen renders (spec-v1.md §7). Pure/synchronous — every
 * input is already bundled in the JS bundle (`data.ts`), so there is no
 * loading state to model here; the screen's own state is just "has the
 * user submitted a valid coordinate yet".
 */
export function lookupHandbookData(lat: number, lon: number): HandbookLookupResult {
  const pgaZone = lookupPgaZone(lat, lon, PGA_ZONES);
  const vs30MS = sampleVs30(VS30_GRID, lat, lon);

  return {
    lat,
    lon,
    pgaZone,
    vs30MS,
    vs30Citation: VS30_GRID.citation,
    siteClass: vs30MS === null ? null : siteClassFromVs30(vs30MS),
    nearbySoilPoints: nearbySoilPoints(lat, lon, SOIL_POINTS),
    isc2025: lookupIsc2025(lat, lon),
  };
}
