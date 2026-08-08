/** Engineering-handbook tunables (D14: engineering-owned defaults, no science
 * review needed — same convention as `features/catalog/config.ts`). */

/** Search radius for "nearby Sulaimani soil/site investigation points"
 * (spec-v1.md §7: "within ~15 km"). */
export const SOIL_NEARBY_RADIUS_KM = 15;

/** The D20-confirmed GMPE set this app's hazard/ShakeMap computations use
 * (`docs/decisions.md` D20) — surfaced verbatim in the handbook's
 * transparency row, never recomputed or paraphrased here so it can't drift
 * from the decision record. */
export const GMPE_SET_LABEL = "CY14, ASB14, BSSA14, Kale15-Iran";
