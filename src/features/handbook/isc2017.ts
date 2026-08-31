import { ISC2017_ZONES } from "./data";
import { pointInRing } from "./point-in-polygon";
import type { Isc2017Band, Isc2017Quantity, Isc2017Result } from "./types";

/**
 * Iraqi Seismic Code 2017 design ground motions for a coordinate.
 *
 * The 2017 code is the one IN FORCE, and this is the source an engineer
 * picks when they need an answer their reviewer can check against the
 * standard on their desk. Its numbers come straight off the code's own
 * Figures 2-2/1(a), (b) and (c) — `Ss`, `S1` and `PGA`, site class B, 2%
 * probability of exceedance in 50 years. Extraction and validation live in
 * `bumelerze-engine/scripts/build_isc2017_hazard.py`.
 *
 * BANDS, NOT POINT VALUES
 * -----------------------
 * This differs from ISC-2025 in kind, not just in vintage. 2025 publishes
 * 79 district values and the app interpolates between them, so it answers
 * "what is the value HERE". 2017 publishes coloured bands, so it answers
 * "which band is this site in" — every site inside the 0.5 g band reads
 * 0.5 g, flat, and two sites 300 m either side of a boundary differ by a
 * whole step. That is what the code prints, and the UI says which kind of
 * answer it gave rather than letting the two look interchangeable.
 *
 * Bands are tested strongest-first, so the sliver of overlap that
 * simplification can introduce resolves toward the higher design value —
 * the same conservative direction `isc2025.ts` uses.
 */

function bandAt(quantity: Isc2017Quantity, lat: number, lon: number): Isc2017Band | null {
  for (const band of ISC2017_ZONES.quantities[quantity]) {
    if (pointInRing(lat, lon, band.ring)) {
      return band;
    }
  }
  return null;
}

export function lookupIsc2017(lat: number, lon: number): Isc2017Result {
  const ss = bandAt("ss", lat, lon);
  const s1 = bandAt("s1", lat, lon);
  const pga = bandAt("pga", lat, lon);

  return {
    // All three or nothing. A site that resolved on two maps but fell in
    // the ~2% of edge sliver the third does not cover would otherwise
    // produce a spectrum built from a missing input, which is worse than
    // an honest empty state.
    values:
      ss && s1 && pga
        ? { ss2475: ss.valueG, s12475: s1.valueG, pga2475: pga.valueG }
        : null,
    ssBand: ss,
    s1Band: s1,
    pgaBand: pga,
    returnPeriodYears: ISC2017_ZONES.returnPeriodYears,
  };
}
