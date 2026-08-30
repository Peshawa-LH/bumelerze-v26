/**
 * ISC-2017 §3-4 — seismic load effects and the combinations that carry
 * them, p48-49.
 *
 * WHY THIS IS WORTH SHIPPING
 * --------------------------
 * The value an engineer copies out of §3-4 is not the algebra, which they
 * know: it is `0.2 SDS`, the vertical seismic coefficient, evaluated for
 * their own site. The app already has `SDS`, so it can print
 * `E = rho QE + 0.201 D` instead of a symbol, and `Omega0 QE` with the real
 * overstrength factor for the chosen system.
 *
 * WHAT IS DELIBERATELY LEFT SYMBOLIC
 * ----------------------------------
 * `rho`, the redundancy factor (§3-3/3), stays a symbol. It depends on
 * whether removing one element would cost more than a set fraction of a
 * storey's lateral capacity, which is a per-storey check on a structure the
 * app has never seen. Offering a number would be inventing one. Same
 * reasoning keeps the irregularity tables (3-3/1, 3-3/2) out entirely:
 * they are conditions an engineer evaluates against a plan, not values a
 * coordinate implies.
 */

/** ISC-2017 §3-4: the vertical seismic term is omitted entirely where
 * `SDS <= 0.125`, in equations 3-4/1, 3-4/14, 3-4/15 and 3-4/16. */
export const VERTICAL_TERM_SDS_THRESHOLD = 0.125;

export interface SeismicLoadEffects {
  /** `0.2 SDS`, the coefficient on dead load `D`. Zero where the code
   * drops the vertical term. */
  verticalCoefficient: number;
  /** True where `SDS <= 0.125` and the vertical term is omitted. */
  verticalTermOmitted: boolean;
  /** System overstrength factor, for the special seismic load. */
  omega0: number;
}

export function seismicLoadEffects(sds: number, omega0: number): SeismicLoadEffects {
  const omitted = sds <= VERTICAL_TERM_SDS_THRESHOLD;
  return {
    verticalCoefficient: omitted ? 0 : 0.2 * sds,
    verticalTermOmitted: omitted,
    omega0,
  };
}

/** The load combinations from §3-4 that actually contain `E`. The other
 * eight (gravity and wind) are not reproduced: an engineer does not come to
 * a seismic tool for `1.4(D+F)`, and listing them would bury the two that
 * matter. */
export const SEISMIC_LOAD_COMBINATIONS: readonly { eq: string; expression: string }[] = [
  { eq: "3-4/6", expression: "1.2 D + 1.0 E + f1 L" },
  { eq: "3-4/8", expression: "0.9 D + 1.0 E + 1.6 H" },
  { eq: "3-4/10", expression: "D + H + F + (W or 0.7 E)" },
  { eq: "3-4/13", expression: "0.6 D + 0.7 E + H" },
];
