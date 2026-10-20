import type { RegionBbox } from "./marker-helpers";

/**
 * "Home" on the Map tab (owner, 2026-09-27): about 150 km around the
 * reader's own location, when a fix is already known. Fixed half-spans in
 * degrees rather than a projection: at this latitude 0.7° of latitude and
 * 0.9° of longitude are both about 75–80 km, and Home is a framing, not a
 * measurement. The same numbers as `homeBboxAround` in `map.web.tsx`
 * (that file is web-only, so the native map cannot import it).
 */
export function homeBboxAround(lat: number, lon: number): RegionBbox {
  return { minLat: lat - 0.7, maxLat: lat + 0.7, minLon: lon - 0.9, maxLon: lon + 0.9 };
}
