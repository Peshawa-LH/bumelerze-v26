import { FE_GRID_ROWS, FE_REGION_NAMES_EN } from "./data/fe-regions.generated";

/**
 * Flinn-Engdahl (F-E) region lookup by epicentre (D28 decision 1).
 *
 * Why derived rather than read from the provider: only EMSC (`flynn_region`)
 * and ISC/GEOFON carry an F-E name; USGS, the feed most of the World view
 * comes from, sends bearing-format English prose. Looking the region up from
 * the coordinates gives every provider, the catalog and the Historical View
 * the SAME name for the same place, with no network and no provider string.
 *
 * Cost: one array index plus a scan of at most a few dozen 4-character tokens
 * (the 1-degree latitude row), so it is cheap enough to run per list row on a
 * low-end Android phone. Resolution is the 1995 revision's 1-degree grid, the
 * same one EMSC and ISC use.
 */

/** Number of F-E regions (1-based region numbers 1..757). */
export const FE_REGION_COUNT = 757;

const TOKEN = 4;
/** 91 latitude rows (0..90 degrees from the equator) per quadrant. */
const ROWS_PER_QUADRANT = 91;

function quadrantIndex(lat: number, lon: number): number {
  // Order in the generated table: ne, nw, se, sw.
  if (lat >= 0) {
    return lon >= 0 ? 0 : 1;
  }
  return lon >= 0 ? 2 : 3;
}

/**
 * F-E region number (1..757) containing a point, or `null` for a
 * non-finite or out-of-range coordinate. Same semantics as the reference
 * implementation (ObsPy `FlinnEngdahl.get_number`): the 1-degree cell is taken
 * by truncating the absolute values toward zero, and -180 longitude is 180.
 */
export function flinnEngdahlNumber(lat: number, lon: number): number | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return null;
  }
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return null;
  }
  const lonValue = lon === -180 ? 180 : lon;
  const absLon = Math.trunc(Math.abs(lonValue));
  const absLat = Math.trunc(Math.abs(lat));
  const row = FE_GRID_ROWS[quadrantIndex(lat, lonValue) * ROWS_PER_QUADRANT + absLat];
  if (!row) {
    return null;
  }
  let found = 0;
  for (let i = 0; i < row.length; i += TOKEN) {
    if (parseInt(row.slice(i, i + 2), 36) > absLon) {
      break;
    }
    found = parseInt(row.slice(i + 2, i + TOKEN), 36);
  }
  return found >= 1 ? found : null;
}

/** Readable English name of an F-E region (the fallback when no translation
 * exists), or `null` for a number outside 1..757. */
export function flinnEngdahlNameEn(regionNumber: number): string | null {
  return FE_REGION_NAMES_EN[regionNumber - 1] ?? null;
}
