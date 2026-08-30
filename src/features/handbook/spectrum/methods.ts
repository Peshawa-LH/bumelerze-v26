/**
 * Which standard's equations build the spectrum.
 *
 * The maps are always the Iraqi ones — ISC-2025 is the only published
 * hazard for Iraq — and the METHOD decides which equations turn those
 * mapped values into a spectrum, and which mapped value it needs.
 *
 * WHY ASCE 7-10 AND THE IRAQI CODE ARE THE SAME CURVE
 * ---------------------------------------------------
 * ISC-2017 took ASCE 7-05/7-10's four spectrum branches AND its `Fa`/`Fv`
 * tables unchanged — verified cell by cell against the Iraqi code PDF. So
 * selecting ASCE 7-10 produces an identical curve, and the UI says so
 * rather than implying a difference that does not exist. ASCE 7-16 revised
 * the site coefficients and WOULD differ, but that standard is not held
 * here and its coefficients will not be written from memory.
 */

export type SpectrumMethodId = "isc" | "asce710" | "ec8";

export interface SpectrumMethod {
  id: SpectrumMethodId;
  /**
   * Return period, years, of the mapped value this method is fed.
   *
   * ISC and ASCE take the 2475-year values, which is the basis their own
   * `SMS = Fa Ss` chain assumes.
   *
   * EC8 takes the **1000-year** values. Its own reference is the 475-year
   * hazard for the no-collapse requirement, which the ISC-2025 sheets do
   * not publish; 1000 years is the closest they offer and is the owner's
   * decision (2026-08-30). It is still not 475, and the UI says so.
   */
  returnPeriodYears: 2475 | 1000;
  /** Which mapped quantities the method consumes. */
  needs: "ssS1" | "pga";
}

export const SPECTRUM_METHODS: readonly SpectrumMethod[] = [
  { id: "isc", returnPeriodYears: 2475, needs: "ssS1" },
  { id: "asce710", returnPeriodYears: 2475, needs: "ssS1" },
  { id: "ec8", returnPeriodYears: 1000, needs: "pga" },
];

export const DEFAULT_SPECTRUM_METHOD: SpectrumMethodId = "isc";

export function spectrumMethod(id: SpectrumMethodId): SpectrumMethod {
  const found = SPECTRUM_METHODS.find((m) => m.id === id);
  if (!found) {
    throw new Error(`unknown spectrum method: ${id}`);
  }
  return found;
}

/** ASCE 7-10 and the Iraqi code share equations and site-coefficient
 * tables, so a reader who picks either must be told they coincide. */
export function methodDuplicatesIsc(id: SpectrumMethodId): boolean {
  return id === "asce710";
}
