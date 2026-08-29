import { IMPORTANCE_FACTOR, ISC_TL_SECONDS } from "./config";
import { faFromTable, fvFromTable } from "./tables";
import type { OccupancyCategory, SeismicDesignCategory, SpectrumInputs, SpectrumParameters } from "./types";

/**
 * ISC-2017 §2-2/3/§2-2/4 parameter chain and §2-4 seismic design category —
 * every equation number cited is `.claude/research/handbook-spectra-design.md`
 * §3.3 [P], verified against the code's own Appendix B worked example
 * (`__tests__/compute.test.ts` reproduces it as a literal regression test).
 */

const SDC_LETTERS: readonly SeismicDesignCategory[] = ["A", "B", "C", "D"];

function moreSevere(a: SeismicDesignCategory, b: SeismicDesignCategory): SeismicDesignCategory {
  return SDC_LETTERS.indexOf(a) >= SDC_LETTERS.indexOf(b) ? a : b;
}

/**
 * ISC-2017 Table 2-4/1 (SDS-driven half of the seismic design category).
 * Table prints three occupancy columns per band ("B / B / C" for
 * 0.167-0.33, etc.) — only category IV diverges from I/II and III in every
 * band, so the branch only needs to special-case IV.
 */
function sdcFromSDS(sds: number, occupancy: OccupancyCategory): SeismicDesignCategory {
  if (sds < 0.167) return "A";
  if (sds < 0.33) return occupancy === "IV" ? "C" : "B";
  if (sds < 0.5) return occupancy === "IV" ? "D" : "C";
  return "D";
}

/** ISC-2017 Table 2-4/2 (SD1-driven half). Same table shape as `sdcFromSDS`,
 * different thresholds. */
function sdcFromSD1(sd1: number, occupancy: OccupancyCategory): SeismicDesignCategory {
  if (sd1 < 0.067) return "A";
  if (sd1 < 0.133) return occupancy === "IV" ? "C" : "B";
  if (sd1 < 0.2) return occupancy === "IV" ? "D" : "C";
  return "D";
}

/** "The governing SDC is the more severe of the two tables" (§3.3 [P]). */
function seismicDesignCategory(sds: number, sd1: number, occupancy: OccupancyCategory): SeismicDesignCategory {
  return moreSevere(sdcFromSDS(sds, occupancy), sdcFromSD1(sd1, occupancy));
}

/**
 * Runs the full ISC-2017 §2-2/3 to §2-4 chain from the engineer's raw
 * inputs. Deliberately stops short of a governing base-shear coefficient:
 * eq. (3-9/3)'s `Cs <= SD1 / (T (R/I))` cap needs the structure's
 * fundamental period `T`, and this calculator collects no
 * period/height/weight input (`handbook-spectra-design.md` §7.4 lists
 * `Ss`, `S1`, site class, occupancy and `R` only — no `Ta`, no `hn`, no
 * `W`). That T-dependent cap is not invented here; it is exactly what the
 * reduced spectrum curve's own `Ts < T <= TL` branch already draws
 * (`curve.ts`), so an engineer reads it off the chart at their own
 * building's period rather than this module guessing one. `csUnreduced`
 * and `csFloor` are the two T-INDEPENDENT pieces of the formula, both
 * genuinely constant and both shown as horizontal guide lines on that
 * chart (§7.2).
 */
export function computeSpectrumParameters(inputs: SpectrumInputs): SpectrumParameters {
  const fa = faFromTable(inputs.ss, inputs.siteClass);
  const fv = fvFromTable(inputs.s1, inputs.siteClass);

  const sms = fa * inputs.ss; // eq. (2-2/1)
  const sm1 = fv * inputs.s1; // eq. (2-2/2)
  const sds = (2 / 3) * sms; // eq. (2-2/3)
  const sd1 = (2 / 3) * sm1; // eq. (2-2/4)

  // T0/Ts are only meaningful once SDS is nonzero; a zero SDS (Ss = 0) is
  // outside the input bounds this module is validated against (config.ts's
  // SS_INPUT_BOUND excludes 0) but guarded anyway so this function never
  // divides by zero for a caller that bypasses validation.
  const t0 = sds > 0 ? 0.2 * (sd1 / sds) : 0;
  const ts = sds > 0 ? sd1 / sds : 0;

  const importanceFactor = IMPORTANCE_FACTOR[inputs.occupancy];

  return {
    fa,
    fv,
    sms,
    sm1,
    sds,
    sd1,
    t0,
    ts,
    tl: ISC_TL_SECONDS,
    importanceFactor,
    seismicDesignCategory: seismicDesignCategory(sds, sd1, inputs.occupancy),
    csUnreduced: sds / (inputs.r / importanceFactor), // eq. (3-9/2)
    csFloor: 0.044 * sds * importanceFactor, // eq. (3-9/4), no extra 0.01 floor
  };
}
