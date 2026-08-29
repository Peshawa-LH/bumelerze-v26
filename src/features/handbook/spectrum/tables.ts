import type { IscSiteClass } from "./types";

/**
 * ISC-2017 Tables 2-2/1(a) and 2-2/1(b) — site coefficients `Fa` and `Fv`.
 * Transcribed verbatim from `.claude/research/handbook-spectra-design.md`
 * §3.3, which read them directly out of the code (Latin-headed tables,
 * clean extraction) and cross-checked every cell against ISC-2017's own
 * Appendix B worked example (`Fa = 1.56` for `Ss = 0.3`, class D interpolates
 * exactly; `Fv = 2.4` for `S1 = 0.1`, class D matches the table row
 * directly) plus two independent secondary sources. These are ASCE
 * 7-05/7-10 Tables 11.4-1/11.4-2 UNCHANGED — do not "fix" a cell to match
 * ASCE 7-16, which revised the D/E rows; that would silently stop matching
 * ISC-2017.
 *
 * Both tables carry the note "use linear interpolation for intermediate
 * values" (§3.3 [P]) and a footnote for class F: site-specific
 * geotechnical investigation required. Class F therefore has no row here —
 * callers must branch on site class F before reaching this module, never
 * pass it in.
 */

type FiveTuple = readonly [number, number, number, number, number];

const FA_BREAKPOINTS: FiveTuple = [0.25, 0.5, 0.75, 1.0, 1.25];
const FV_BREAKPOINTS: FiveTuple = [0.1, 0.2, 0.3, 0.4, 0.5];

const FA_TABLE: Record<IscSiteClass, FiveTuple> = {
  A: [0.8, 0.8, 0.8, 0.8, 0.8],
  B: [1.0, 1.0, 1.0, 1.0, 1.0],
  C: [1.2, 1.2, 1.1, 1.0, 1.0],
  D: [1.6, 1.4, 1.2, 1.1, 1.0],
  E: [2.5, 1.7, 1.2, 0.9, 0.9],
};

const FV_TABLE: Record<IscSiteClass, FiveTuple> = {
  A: [0.8, 0.8, 0.8, 0.8, 0.8],
  B: [1.0, 1.0, 1.0, 1.0, 1.0],
  C: [1.7, 1.6, 1.5, 1.4, 1.3],
  D: [2.4, 2.0, 1.8, 1.6, 1.5],
  E: [3.5, 3.2, 2.8, 2.4, 2.4],
};

/** Piecewise-linear interpolation across the table's 5 tabulated columns,
 * clamped flat below the first breakpoint and above the last — exactly
 * what "use linear interpolation for intermediate values" plus the table's
 * own closed range implies (there is no ISC-2017 provision for `Ss` below
 * the first or above the last column; the nearest tabulated value is the
 * only defensible clamp). Written as an explicit 5-point ladder rather
 * than a loop over indexed access so `noUncheckedIndexedAccess` never
 * turns a tuple element into `number | undefined` here. */
function interpolateFiveTuple(breakpoints: FiveTuple, values: FiveTuple, x: number): number {
  const [b0, b1, b2, b3, b4] = breakpoints;
  const [v0, v1, v2, v3, v4] = values;

  if (x <= b0) return v0;
  if (x <= b1) return lerp(b0, v0, b1, v1, x);
  if (x <= b2) return lerp(b1, v1, b2, v2, x);
  if (x <= b3) return lerp(b2, v2, b3, v3, x);
  if (x <= b4) return lerp(b3, v3, b4, v4, x);
  return v4;
}

function lerp(x0: number, y0: number, x1: number, y1: number, x: number): number {
  return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
}

/** `Fa` (short-period site coefficient), Table 2-2/1(a), from `Ss` (g) and
 * site class A-E. */
export function faFromTable(ss: number, siteClass: IscSiteClass): number {
  return interpolateFiveTuple(FA_BREAKPOINTS, FA_TABLE[siteClass], ss);
}

/** `Fv` (1-second site coefficient), Table 2-2/1(b), from `S1` (g) and
 * site class A-E. */
export function fvFromTable(s1: number, siteClass: IscSiteClass): number {
  return interpolateFiveTuple(FV_BREAKPOINTS, FV_TABLE[siteClass], s1);
}
