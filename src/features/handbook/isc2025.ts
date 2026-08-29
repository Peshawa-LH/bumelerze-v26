import { haversineDistanceKm } from "@/features/events/distance";

import { ISC2025_DISTRICTS, ISC2025_SS_ZONES } from "./data";
import { pointInRing } from "./point-in-polygon";
import type { Isc2025District, Isc2025Result, Isc2025SsZone } from "./types";

/**
 * Iraqi Seismic Code 2025 design ground motions for a coordinate.
 *
 * This is what `spectrum/types.ts` calls "wave 3" — deriving `Ss`/`S1` from
 * a coordinate instead of asking the engineer for both. It arrives from the
 * 2025 sources rather than by digitizing the 2017 figures that note
 * anticipated: IMOS published an `Ss` zonation map and a district value
 * table, so the numbers are read rather than traced off a contour plot.
 * Extraction, georeferencing and validation live in
 * `bumelerze-engine/scripts/build_isc2025_hazard.py`; per-run counts are in
 * `bumelerze-engine/handbook-data/ISC2025_REPORT.md`.
 *
 * TWO ANSWERS, DELIBERATELY NOT MERGED
 * ------------------------------------
 * The district table is a published value AT a published point; the zone
 * map is a published band covering everywhere. They answer different
 * questions and are kept apart rather than blended into one interpolated
 * number the code never printed:
 *
 * - `district` is exact where the site IS the district, and progressively
 *   less relevant with distance, so its `distanceKm` always travels with
 *   it and the UI must show it.
 * - `zone` bounds `Ss` for any site inside Iraq, including sites nowhere
 *   near a tabulated district.
 *
 * Interpolating between districts would invent values, and across the
 * Zagros front the gradient is steep enough (Ss runs 0.2 to 1.9 g over the
 * country) that an invented value could sit a whole class away from both
 * neighbours.
 */

/** Zones are tested strongest-first so that any overlap introduced by the
 * gap-filling in the build script resolves toward the higher design value.
 * Overlap should not occur -- the bands partition Iraq -- but if the source
 * map is ever redrawn with touching edges, erring high is the only safe
 * direction for a design tool. */
const ZONE_STRENGTH_ORDER = ["V", "IV", "III", "II", "I"] as const;

export function lookupSsZone(
  lat: number,
  lon: number,
  zones: readonly Isc2025SsZone[] = ISC2025_SS_ZONES,
): Isc2025SsZone | null {
  for (const label of ZONE_STRENGTH_ORDER) {
    for (const zone of zones) {
      if (zone.zone === label && pointInRing(lat, lon, zone.ring)) {
        return zone;
      }
    }
  }
  return null;
}

export interface NearestIsc2025District {
  district: Isc2025District;
  distanceKm: number;
}

export function nearestIsc2025District(
  lat: number,
  lon: number,
  districts: readonly Isc2025District[] = ISC2025_DISTRICTS,
): NearestIsc2025District | null {
  let best: NearestIsc2025District | null = null;
  for (const district of districts) {
    const distanceKm = haversineDistanceKm(lat, lon, district.lat, district.lon);
    if (best === null || distanceKm < best.distanceKm) {
      best = { district, distanceKm };
    }
  }
  return best;
}

/**
 * Composes both answers for one coordinate. Pure and synchronous — both
 * datasets are bundled JSON (`data.ts`), same as every other handbook
 * lookup.
 */
export function lookupIsc2025(lat: number, lon: number): Isc2025Result {
  return {
    zone: lookupSsZone(lat, lon),
    nearestDistrict: nearestIsc2025District(lat, lon),
  };
}
