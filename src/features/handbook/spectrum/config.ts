import type { OccupancyCategory } from "./types";

/**
 * ISC-2017 spectrum tunables (D14: engineering-owned defaults, same
 * convention as `handbook/config.ts`). Every numeric value here is
 * `[P]`-cited in `.claude/research/handbook-spectra-design.md` §3.3/§10.1.
 */

/** ISC-2017 §2-2/5: "TL may be taken, for the conditions of Iraqi
 * buildings, equal to 6 seconds" — a single national constant, never
 * derived from `SDS`/`SD1` the way `T0`/`Ts` are. */
export const ISC_TL_SECONDS = 6;

/** ISC-2017 Table 2-3/1 importance factors. Categories I and II are one
 * option in the UI (`I_II`) because the code's own table groups them under
 * the same factor, not a simplification introduced here. */
export const IMPORTANCE_FACTOR: Record<OccupancyCategory, number> = {
  I_II: 1.0,
  III: 1.25,
  IV: 1.5,
};

/**
 * Response modification coefficient `R` — a short, VERIFIED list only, per
 * `handbook-spectra-design.md` §11 item 1: the full ISC-2017 Table 3-2/1
 * (R / Omega0 / Cd per structural system) sits on a page whose Arabic font
 * has the broken digit map diagnosed in that document's §0.2, extracts as
 * `2.2`, `1..2`, `2.22`, `4.2`, is not arithmetically checkable, and
 * disagrees with the ASCE 7 values it should resemble. Shipping that table
 * would be exactly the "plausible wrong number" failure mode this feature
 * exists to avoid.
 *
 * The ONLY value verified end-to-end (Appendix B's own worked example,
 * corroborated by two independent secondary sources) is `R = 4` for an
 * intermediate reinforced-concrete moment frame. Everything else is free
 * entry — the UI must say so, never imply this list is the code's full
 * table.
 */
export const VERIFIED_R_VALUES: readonly { r: number; labelKey: string }[] = [
  { r: 4, labelKey: "handbook.spectrum.rOptions.rcMomentFrameIntermediate" },
];

/**
 * No system is selected by default: the form opens with a plain `R` field.
 *
 * The RESPONSE SPECTRUM does not depend on the structural system at all —
 * ISC-2017 §2-2/5 builds it from `SDS`, `SD1`, `T0`, `Ts` and `TL` only, and
 * `R` enters nowhere in it. `R` is needed for base shear, the reduced
 * curve, drift amplification and the load combinations, and most engineers
 * already know theirs. Forcing a 16-row list in front of everyone to reach
 * a number they could type was the wrong default.
 *
 * Choosing a system is still offered, and still worth it: it is what yields
 * `Omega0`, `Cd` and the height-limit compliance check, none of which an
 * engineer can get from `R` alone.
 */
export const DEFAULT_STRUCTURAL_SYSTEM_ID: string | null = null;

/** Opening `R`. ISC-2017's own Appendix B worked example uses 4 for an
 * intermediate reinforced-concrete moment frame, so the form's first paint
 * reproduces the code's own example rather than an arbitrary pick. */
export const DEFAULT_R = 4;

/** Building height above the base, metres. The upper bound is not a code
 * limit — the code expresses limits per system and design category — just
 * input sanity, wide enough for anything built in Iraq. */
export const BUILDING_HEIGHT_BOUND = { min: 1, max: 400 };

/** Reasonable free-entry bounds for `R` — wide enough to cover every real
 * structural system (unreinforced masonry near 1.5 through ductile steel
 * frames near 8) without accepting a typo like `40`. Not a code citation,
 * just input sanity (`handbook-spectra-design.md` names no source for a
 * generic bound because none exists without the withheld table). */
export const R_INPUT_BOUND = { min: 1, max: 8 };

/** `Ss`/`S1` free-entry bounds, g. ISC-2017's own tables only tabulate
 * `Fa`/`Fv` up to `Ss = 1.25` / `S1 = 0.5` (values beyond that use the
 * table's own top row per its interpolation note — see `tables.ts`), and
 * Iraq's mapped hazard does not approach the tectonically active regions
 * where `Ss` exceeds 2. The upper bound here is intentionally generous
 * rather than tectonically derived. */
export const SS_INPUT_BOUND = { min: 0.01, max: 3 };
export const S1_INPUT_BOUND = { min: 0.01, max: 2 };

/** Default period-axis range for the chart, seconds (§8.1: "0-4 s covers
 * essentially all buildings; TL = 6 s sits off the default view"). The
 * extended range below covers the fourth branch (`T > TL`) once the
 * "show full range" toggle is on. */
export const CHART_DEFAULT_T_MAX = 4;
export const CHART_EXTENDED_T_MAX = 8;

/** Sampling step for the plotted curve and the copy-to-clipboard series
 * (§7.5 recommends 0.01 s; 0.02 s here keeps the point count sane for the
 * extended 0-8 s range on a low-end Android device without visibly
 * degrading the curve). Exact corner points (`T0`, `Ts`, `TL`) are always
 * injected in addition to this grid, never approximated by it (§7.5). */
export const SPECTRUM_SAMPLE_STEP_S = 0.02;
