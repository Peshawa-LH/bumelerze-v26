/** Engineering-handbook tunables (D14: engineering-owned defaults, no science
 * review needed — same convention as `features/catalog/config.ts`). */

/** Search radius for "nearby Sulaimani soil/site investigation points"
 * (spec-v1.md §7: "within ~15 km"). */
export const SOIL_NEARBY_RADIUS_KM = 15;

/** The D20-confirmed GMPE set this app's hazard/SHAKEmap computations use
 * (`docs/decisions.md` D20) — surfaced verbatim in the handbook's
 * transparency row, never recomputed or paraphrased here so it can't drift
 * from the decision record. */
export const GMPE_SET_LABEL = "CY14, ASB14, BSSA14, Kale15-Iran";

/**
 * Display rounding step (m/s) for the bundled Vs30 grid value (owner
 * feedback 2026-08-21: showing it to the nearest 1 m/s claims precision
 * the source data can't support). The grid is a topographic-slope proxy
 * (SRTM30+, `HANDBOOK_DATA_REPORT.md` §2) downsampled to a 0.05°
 * (~5.5 km) cell and bilinearly interpolated at query time
 * (`vs30-sample.ts`) — a coarse global model, not a site measurement.
 * Rounding to the nearest 25 m/s keeps the number honest about that
 * without hiding it (D14: caveat, don't hide).
 */
export const VS30_DISPLAY_PRECISION_MS = 25;
