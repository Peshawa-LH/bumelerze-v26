import { ISC2025_SURFACE } from "./data";
import type { Isc2025Field, Isc2025SurfaceModel } from "./types";

/**
 * Evaluates the Iraqi Seismic Code 2025 design ground motions continuously,
 * at any coordinate inside the country.
 *
 * WHY THIS EXISTS
 * ---------------
 * The code publishes 79 district values, and a site is almost never one of
 * them. Serving the nearest district was the first approach and it is
 * poor: leave-one-out scores it at 0.140 g RMS, because "nearest" can be
 * 40 km away across the Zagros gradient, where the field runs 0.2 to 1.9 g.
 * Sulaimani, for instance, borrowed Chamchamal 44 km away.
 *
 * This is a cubic radial basis function fitted through the same published
 * values by `bumelerze-engine/scripts/build_isc2025_hazard.py`, which emits
 * the solved weights so nothing has to be solved on device. Leave-one-out
 * puts it at 0.029 g RMS on the roughest field, below the 0.05 g contour
 * interval the code's own sheets are drawn at, and it reproduces the
 * published zonation: 6000 random points across Iraq fall inside the band
 * the map paints them in 92.5% of the time.
 *
 *     s(x) = SUM_i w_i * ||x - c_i||^3  +  p0 + p1*xhat + p2*yhat
 *     xhat = (x - shift) / scale
 *
 * The kernel term uses raw lon/lat while the polynomial tail uses shifted
 * and scaled coordinates. That split is not a choice -- it is SciPy's own
 * convention, and the generator asserts this form against SciPy to 1e-9
 * before emitting, so the two must not drift apart.
 */

const MODEL = ISC2025_SURFACE;

/**
 * Interpolation, never extrapolation. A cubic RBF grows without bound
 * outside the hull of its centres, so a coordinate in Turkey or Saudi
 * Arabia would otherwise produce a large, confident, meaningless number.
 * Callers must establish the point is inside Iraq first -- `lookupIsc2025`
 * does, via the zone polygons -- and the clamp here is a second line of
 * defence, not the primary one.
 */
export function evaluateIsc2025Field(
  field: Isc2025Field,
  lat: number,
  lon: number,
  model: Isc2025SurfaceModel = MODEL,
): number {
  const spec = model.fields[field];
  if (!spec) {
    throw new Error(`unknown ISC-2025 field: ${field}`);
  }
  let total = 0;
  for (let i = 0; i < model.centres.length; i += 1) {
    const centre = model.centres[i];
    const weight = spec.w[i];
    if (!centre || weight === undefined) {
      continue;
    }
    const dx = lon - centre[0];
    const dy = lat - centre[1];
    const r = Math.hypot(dx, dy);
    total += weight * r * r * r;
  }
  const xHat = (lon - model.shift[0]) / model.scale[0];
  const yHat = (lat - model.shift[1]) / model.scale[1];
  total += (spec.poly[0] ?? 0) + (spec.poly[1] ?? 0) * xHat + (spec.poly[2] ?? 0) * yHat;

  return Math.min(Math.max(total, spec.min), spec.max);
}

/** All six published fields at one coordinate. */
export function evaluateIsc2025(lat: number, lon: number): Record<Isc2025Field, number> {
  return {
    ss2475: evaluateIsc2025Field("ss2475", lat, lon),
    s12475: evaluateIsc2025Field("s12475", lat, lon),
    pga2475: evaluateIsc2025Field("pga2475", lat, lon),
    ss1000: evaluateIsc2025Field("ss1000", lat, lon),
    s11000: evaluateIsc2025Field("s11000", lat, lon),
    pga1000: evaluateIsc2025Field("pga1000", lat, lon),
  };
}
