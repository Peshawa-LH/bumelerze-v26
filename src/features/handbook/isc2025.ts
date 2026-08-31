import { haversineDistanceKm } from "@/features/events/distance";

import { ISC2025_DISTRICTS, ISC2025_SS_ZONES } from "./data";
import { evaluateIsc2025 } from "./isc2025-surface";
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
 * THREE ANSWERS, EACH DOING A DIFFERENT JOB
 * -----------------------------------------
 * - `values` are the design numbers AT the queried point, interpolated
 *   through all 79 published district values (`isc2025-surface.ts`). This
 *   is what the engineer designs from.
 * - `zone` is the band the code's own sheet paints the point in. It is an
 *   independent check on `values`, drawn from a different artifact.
 * - `nearestDistrict` is provenance and a sanity anchor: the closest place
 *   where the code prints a number outright.
 *
 * Serving the nearest district as THE value was the first approach here
 * and it was wrong: leave-one-out scores it at 0.140 g RMS against 0.029 g
 * for the interpolant, because across the Zagros front "nearest" can be
 * 40 km away and a whole class out. Sulaimani borrowed Chamchamal, 44 km
 * off, and read 1.09 g where the surface gives 1.22 g.
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
  const zone = lookupSsZone(lat, lon);
  return {
    // Gated on the zone polygons rather than on distance: they ARE the
    // country's mapped extent. A cubic RBF extrapolates without bound, so
    // a point in Turkey must get null, not a confident large number.
    values: zone === null ? null : evaluateIsc2025(lat, lon),
    zone,
    nearestDistrict: nearestIsc2025District(lat, lon),
  };
}

/**
 * The district's name in the reader's script.
 *
 * The code prints every district in Arabic, and that name is carried in the
 * data. Sorani is written in Arabic script, so a Sorani or Arabic reader
 * should see the code's own name rather than a Latin transliteration
 * stranded inside a right-to-left sentence. Kurmanji and English take the
 * Latin name. Caught in RTL verification, 2026-08-31.
 */
export function districtDisplayName(district: Isc2025District, locale: string): string {
  const arabicScript = locale === "ar" || locale === "ckb";
  return arabicScript && district.nameAr ? district.nameAr : district.nameEn;
}
