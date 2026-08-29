import { SPECTRUM_SAMPLE_STEP_S } from "./config";
import type { SpectrumCurve, SpectrumParameters, SpectrumPoint } from "./types";

/**
 * ISC-2017 §2-2/5 Figure 2-2/2 — the four-branch design response spectrum,
 * plus the R/I-reduced curve an engineer actually puts in a model (§7.2).
 * Equation numbers per `.claude/research/handbook-spectra-design.md` §3.2:
 *
 *   T <  T0        : Sa = SDS (0.4 + 0.6 T/T0)     (2-2/5)
 *   T0 <= T <= Ts   : Sa = SDS                       (stated in prose)
 *   Ts <  T <= TL   : Sa = SD1 / T                    (2-2/6)
 *   T  >  TL        : Sa = SD1 TL / T^2               (2-2/6, misprinted —
 *                     the code repeats the equation number; the branch
 *                     itself is distinct and correct, see the doc's own
 *                     note on this)
 *
 * Damping is fixed at 5% throughout — ISC-2017 defines SDS/SD1 at 5%
 * damping and has no damping-adjustment factor (no analogue of EC8's eta).
 * There is deliberately no damping parameter anywhere in this module.
 */
export function spectralAcceleration(
  t: number,
  params: Pick<SpectrumParameters, "sds" | "sd1" | "t0" | "ts" | "tl">,
): number {
  const { sds, sd1, t0, ts, tl } = params;

  if (t < t0) {
    // t0 === 0 makes this branch unreachable for any t >= 0, so the
    // division below never actually executes with t0 = 0.
    return sds * (0.4 + 0.6 * (t / t0));
  }
  if (t <= ts) {
    return sds;
  }
  if (t <= tl) {
    return sd1 / t;
  }
  return (sd1 * tl) / (t * t);
}

/** `Sa(T) * I / R` — the behaviour-reduced curve (§7.2). */
export function reducedSpectralAcceleration(
  t: number,
  params: Pick<SpectrumParameters, "sds" | "sd1" | "t0" | "ts" | "tl" | "importanceFactor">,
  r: number,
): number {
  return (spectralAcceleration(t, params) * params.importanceFactor) / r;
}

/** Builds the sorted, deduplicated set of periods to sample: a uniform grid
 * from 0 to `tMax` at `SPECTRUM_SAMPLE_STEP_S`, plus the exact corner
 * periods (`T0`, `Ts`, and `TL` when it falls within range) — never
 * approximated by the nearest grid point (§7.5's "a spectrum resampled on
 * a uniform grid that misses T0 and Ts has a visibly wrong plateau"). */
function samplePeriods(
  tMax: number,
  cornerPeriods: readonly number[],
): readonly { t: number; isCornerPoint: boolean }[] {
  const seen = new Map<number, boolean>();

  for (let t = 0; t <= tMax + 1e-9; t += SPECTRUM_SAMPLE_STEP_S) {
    // Round to avoid float step drift creating near-duplicate keys.
    const rounded = Math.round(t * 1000) / 1000;
    if (!seen.has(rounded)) {
      seen.set(rounded, false);
    }
  }

  for (const corner of cornerPeriods) {
    if (corner >= 0 && corner <= tMax) {
      const rounded = Math.round(corner * 1000) / 1000;
      seen.set(rounded, true);
    }
  }

  return Array.from(seen.entries())
    .sort(([a], [b]) => a - b)
    .map(([t, isCornerPoint]) => ({ t, isCornerPoint }));
}

/** Builds both plotted curves across `[0, tMax]`, sampled at
 * `SPECTRUM_SAMPLE_STEP_S` with the exact corner points injected. */
export function buildSpectrumCurve(params: SpectrumParameters, r: number, tMax: number): SpectrumCurve {
  const periods = samplePeriods(tMax, [params.t0, params.ts, params.tl]);

  const code: SpectrumPoint[] = [];
  const reduced: SpectrumPoint[] = [];
  for (const { t, isCornerPoint } of periods) {
    code.push({ t, sa: spectralAcceleration(t, params), isCornerPoint });
    reduced.push({ t, sa: reducedSpectralAcceleration(t, params, r), isCornerPoint });
  }

  return { code, reduced };
}

/** Tab-separated `T\tSa` series for clipboard export (§7.5), Latin digits
 * and `.` decimals always — this is a data interchange format for
 * spreadsheets/ETABS/SAP2000, not a locale-rendered UI string, so it
 * deliberately does NOT go through `localizeDigits`. */
export function serializeCurveForClipboard(points: readonly SpectrumPoint[]): string {
  const lines = ["T (s)\tSa (g)"];
  for (const point of points) {
    lines.push(`${point.t.toFixed(3)}\t${point.sa.toFixed(4)}`);
  }
  return lines.join("\n");
}
