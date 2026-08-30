import type { SpectrumPoint } from "./types";

/**
 * Eurocode 8 horizontal elastic response spectrum, EN 1998-1:2004 §3.2.2.2,
 * offered as a COMPARISON against the ISC spectrum — never as a design
 * spectrum of record for Iraq.
 *
 * WHY OFFER IT AT ALL
 * -------------------
 * "Is my spectrum right?" is best answered by seeing a second, independent
 * code shape built from the same ground motion. Many engineers in Kurdistan
 * are trained on EC8, and international clients ask for it. Plotting both
 * from one hazard value shows exactly where the two standards differ.
 *
 * THE THREE HONEST CAVEATS, WHICH THE UI MUST CARRY
 * -------------------------------------------------
 * 1. **Return period.** EC8's `agR` is conventionally the 475-year value
 *    (10% in 50 years) for the no-collapse requirement. The ISC-2025 maps
 *    publish 1000 and 2475 years and nothing at 475. Feeding a 2475-year
 *    `ag` produces a far more severe spectrum than EC8 intends. It is a
 *    like-for-like shape comparison at one hazard level, not an EC8 design
 *    spectrum.
 * 2. **No national annex.** `S`, `TB`, `TC`, `TD` and the choice of
 *    spectrum type are national-annex parameters. Iraq has no EC8 national
 *    annex, so the values here are EN 1998-1's own RECOMMENDED ones.
 * 3. **Ground type is not site class.** EC8's A-E and ISC/NEHRP's A-E are
 *    different classifications on different Vs30 boundaries (360 vs 370 m/s
 *    at the key line). The EC8 ground type comes from `site-class.ts`, not
 *    from the ISC class.
 *
 * `gamma_I` is left at 1.0. EC8 applies importance through `ag = gamma_I *
 * agR`, where ISC applies `I` inside `Cs`; mapping ISC occupancy categories
 * onto EC8 importance classes would be inventing a correspondence neither
 * code states.
 */

export type Ec8GroundType = "A" | "B" | "C" | "D" | "E";
export type Ec8SpectrumType = "type1" | "type2";

interface Ec8Parameters {
  /** Soil factor. */
  s: number;
  /** Lower limit of the constant-acceleration branch, seconds. */
  tb: number;
  /** Upper limit of the constant-acceleration branch, seconds. */
  tc: number;
  /** Start of the constant-displacement range, seconds. */
  td: number;
}

/** EN 1998-1 Table 3.2 — recommended Type 1 parameters. Type 1 is the one
 * for Iraq: the note under §3.2.2.2(2)P recommends Type 2 only where the
 * dominant contributing earthquakes have `Ms <= 5.5`, and the Zagros
 * sources that drive Iraqi hazard are well above that. */
const TYPE_1: Record<Ec8GroundType, Ec8Parameters> = {
  A: { s: 1.0, tb: 0.15, tc: 0.4, td: 2.0 },
  B: { s: 1.2, tb: 0.15, tc: 0.5, td: 2.0 },
  C: { s: 1.15, tb: 0.2, tc: 0.6, td: 2.0 },
  D: { s: 1.35, tb: 0.2, tc: 0.8, td: 2.0 },
  E: { s: 1.4, tb: 0.15, tc: 0.5, td: 2.0 },
};

/** EN 1998-1 Table 3.3 — recommended Type 2 parameters, kept for
 * completeness and for any future low-magnitude setting. */
const TYPE_2: Record<Ec8GroundType, Ec8Parameters> = {
  A: { s: 1.0, tb: 0.05, tc: 0.25, td: 1.2 },
  B: { s: 1.35, tb: 0.05, tc: 0.25, td: 1.2 },
  C: { s: 1.5, tb: 0.1, tc: 0.25, td: 1.2 },
  D: { s: 1.8, tb: 0.1, tc: 0.3, td: 1.2 },
  E: { s: 1.6, tb: 0.05, tc: 0.25, td: 1.2 },
};

/** Damping correction factor, 1.0 at the 5% reference damping (§3.2.2.2(3)). */
export const EC8_ETA_5_PERCENT = 1.0;

/** EN 1998-1 defines the spectrum out to 4 s (eq. 3.5) and no further.
 * Beyond that the curve is not drawn rather than extrapolated. */
export const EC8_MAX_PERIOD_S = 4;

export function ec8Parameters(
  groundType: Ec8GroundType,
  spectrumType: Ec8SpectrumType = "type1",
): Ec8Parameters {
  return spectrumType === "type1" ? TYPE_1[groundType] : TYPE_2[groundType];
}

/**
 * `Se(T)`, EN 1998-1 equations 3.2 to 3.5.
 *
 *   0  <= T <= TB : ag S [1 + (T/TB)(eta 2.5 - 1)]
 *   TB <= T <= TC : ag S eta 2.5
 *   TC <= T <= TD : ag S eta 2.5 (TC/T)
 *   TD <= T <= 4s : ag S eta 2.5 (TC TD / T^2)
 */
export function ec8Spectrum(
  t: number,
  ag: number,
  groundType: Ec8GroundType,
  spectrumType: Ec8SpectrumType = "type1",
  eta: number = EC8_ETA_5_PERCENT,
): number {
  const { s, tb, tc, td } = ec8Parameters(groundType, spectrumType);
  const plateau = ag * s * eta * 2.5;

  if (t <= tb) {
    // At T = 0 this is ag*S, rising linearly to the plateau at TB.
    return ag * s * (1 + (t / tb) * (eta * 2.5 - 1));
  }
  if (t <= tc) {
    return plateau;
  }
  if (t <= td) {
    return plateau * (tc / t);
  }
  return plateau * ((tc * td) / (t * t));
}

/** Samples `Se(T)` for the chart, with the corner periods injected exactly
 * so the plateau does not get rounded off by the sampling grid — the same
 * rule `curve.ts` follows for the ISC spectrum. */
export function buildEc8Curve(
  ag: number,
  groundType: Ec8GroundType,
  tMax: number,
  spectrumType: Ec8SpectrumType = "type1",
  step = 0.02,
): readonly SpectrumPoint[] {
  const { tb, tc, td } = ec8Parameters(groundType, spectrumType);
  const limit = Math.min(tMax, EC8_MAX_PERIOD_S);
  const corners = [tb, tc, td].filter((t) => t <= limit);

  const periods = new Set<number>([0, limit, ...corners]);
  for (let t = 0; t <= limit + 1e-9; t += step) {
    periods.add(Number(t.toFixed(4)));
  }

  return [...periods]
    .sort((a, b) => a - b)
    .map((t) => ({
      t,
      sa: ec8Spectrum(t, ag, groundType, spectrumType),
      isCornerPoint: corners.includes(t),
    }));
}
