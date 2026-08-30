import type { StructuralSystem } from "./structural-systems";

/**
 * ISC-2017 §3-9/3 — the approximate fundamental period `Ta` and the upper
 * limit coefficient `Cu`.
 *
 * WHY THIS MATTERS TO THE SPECTRUM
 * --------------------------------
 * `Cs` is not simply `SDS/(R/I)`. That is only its plateau value, and the
 * code caps it at `SD1/(T·(R/I))`, which needs a period. Without one the
 * app could only ever show the plateau, which over-states the base shear
 * for anything but a short, stiff building. `Ta` is what supplies `T`.
 *
 * Same reading discipline as `structural-systems.ts`: values come from the
 * page rendered at high dpi, never from the PDF's text layer, whose digit
 * map is broken.
 *
 * ISC's `Ct` values are NOT ASCE 7-10's SI values (ASCE has 0.0724 /
 * 0.0466 / 0.0731 / 0.0488 where this code has 0.068 / 0.044 / 0.07 /
 * 0.055). Do not "correct" them toward ASCE.
 */

/** ISC-2017 Table 3-9/2, "approximate period coefficients", p56. */
interface PeriodCoefficients {
  ct: number;
  x: number;
  /** Which row of the table this is, for the citation shown to the user. */
  row: "steelMomentFrame" | "rcMomentFrame" | "steelEbf" | "allOther";
}

const STEEL_MOMENT_FRAME: PeriodCoefficients = { ct: 0.068, x: 0.8, row: "steelMomentFrame" };
const RC_MOMENT_FRAME: PeriodCoefficients = { ct: 0.044, x: 0.9, row: "rcMomentFrame" };
const STEEL_EBF: PeriodCoefficients = { ct: 0.07, x: 0.75, row: "steelEbf" };
const ALL_OTHER: PeriodCoefficients = { ct: 0.055, x: 0.75, row: "allOther" };

/**
 * The moment-frame rows carry a qualifier: the frame must resist 100% of
 * the required seismic force and must not be adjoined or enclosed by
 * components stiff enough to stop it deflecting. Every moment-frame system
 * in `structural-systems.ts` IS the whole lateral system, so the qualifier
 * holds by construction here — it would not if dual systems were added, and
 * those must map to `allOther` rather than to a moment-frame row.
 */
export function periodCoefficientsFor(
  system: StructuralSystem | null,
): PeriodCoefficients {
  // No system chosen: the code's own catch-all row, "all other structural
  // systems". That is the correct answer rather than a refusal — Ta is
  // still well defined, just from the conservative generic row.
  if (!system) {
    return ALL_OTHER;
  }
  switch (system.id) {
    case "mf.steelSpecial":
    case "mf.steelIntermediate":
    case "mf.steelOrdinary":
      return STEEL_MOMENT_FRAME;
    case "mf.rcSpecial":
    case "mf.rcIntermediate":
      return RC_MOMENT_FRAME;
    case "bf.steelEbfMomentConnections":
    case "bf.steelEbfNonMomentConnections":
      return STEEL_EBF;
    default:
      return ALL_OTHER;
  }
}

/** ISC-2017 Eq. 3-9/5: `Ta = Ct · hn^x`, `hn` in metres from the base to
 * the highest level. */
export function approximatePeriod(
  system: StructuralSystem | null,
  heightM: number,
): number {
  const { ct, x } = periodCoefficientsFor(system);
  return ct * Math.pow(heightM, x);
}

/**
 * ISC-2017 Table 3-9/1 — upper-limit coefficient on a period found by
 * analysis.
 *
 * The table is a list of discrete `SD1` rows with NO interpolation note,
 * unlike `Fa`/`Fv` which carry one explicitly. So this steps rather than
 * interpolates, and between rows it takes the row for the next HIGHER
 * tabulated `SD1`, which yields the smaller `Cu`. Smaller `Cu` means a
 * shorter permitted period, hence a larger `Cs`: the conservative
 * direction, which is the right default where the code is silent.
 */
export function upperLimitCoefficient(sd1: number): number {
  if (sd1 >= 0.4) return 1.4;
  if (sd1 >= 0.3) return 1.4;
  if (sd1 >= 0.2) return 1.5;
  if (sd1 >= 0.15) return 1.6;
  return 1.7;
}

export interface PeriodResult {
  /** Approximate fundamental period, seconds. */
  ta: number;
  /** `Cu · Ta` — the ceiling on a period obtained from a modal analysis.
   * Informational here: this app does no modal analysis, so it designs at
   * `Ta` itself, which is the conservative choice the code permits. */
  cuTa: number;
  cu: number;
  ct: number;
  x: number;
  row: PeriodCoefficients["row"];
}

export function computePeriod(
  system: StructuralSystem | null,
  heightM: number,
  sd1: number,
): PeriodResult {
  const { ct, x, row } = periodCoefficientsFor(system);
  const ta = approximatePeriod(system, heightM);
  const cu = upperLimitCoefficient(sd1);
  return { ta, cuTa: cu * ta, cu, ct, x, row };
}
