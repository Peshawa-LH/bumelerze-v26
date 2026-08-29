/**
 * ISC-2017 (Iraqi Seismic Code, IQ.303) design response spectrum — types.
 * Every quantity and equation number cited in these doc comments is
 * `.claude/research/handbook-spectra-design.md` §3.2/§3.3 (own copy of the
 * code, `pdftotext`-extracted and arithmetic-closure-checked — see that
 * document's §0.2). Nothing here is written from recall; where this module
 * disagrees with a stale mental model of ASCE 7, the research document and
 * the code text it quotes win.
 *
 * Wave 1 only (`handbook-spectra-design.md` §9): the engineer supplies `Ss`
 * and `S1` directly. Deriving them from a coordinate needs ISC-2017 Figures
 * 2-2/1(a)/(b) digitized, which is Wave 3 and explicitly out of scope here
 * (see `spectrum/config.ts`'s doc comment on why no `Ss`/`S1` lookup table
 * ships in this module).
 */

/** ISC-2017 site classes reachable from Vs30 alone (Table 7-1/1). Class F
 * ("requires site-specific investigation") is not Vs30-derivable and is
 * handled as its own UI state, never returned by `isc-site-class.ts`. */
export type IscSiteClass = "A" | "B" | "C" | "D" | "E";

/** ISC-2017 Table 2-3/1 occupancy-category grouping. Categories I and II
 * share the same importance factor (1.0) and are offered as one option —
 * the code's own table groups them, not a simplification made here. */
export type OccupancyCategory = "I_II" | "III" | "IV";

/** ISC-2017 Tables 2-4/1 / 2-4/2 seismic design category letters. */
export type SeismicDesignCategory = "A" | "B" | "C" | "D";

/** What the engineer enters directly (§7.4: "user, wave 1"). `siteClass` is
 * always present here even though the UI pre-fills it from the coordinate's
 * Vs30 and lets the engineer override it — by the time this reaches the
 * compute layer, "derived" and "overridden" are the same shape. */
export interface SpectrumInputs {
  /** Mapped short-period (0.2 s) spectral acceleration, g. From ISC-2017
   * Figure 2-2/1(a) — the engineer's own source, not computed by this app
   * (§3.4/§3.5: our bundled PGA map is a different map and a PGA→Ss
   * shortcut is provably wrong by ~2x at the one Iraqi city both values are
   * known for). */
  ss: number;
  /** Mapped 1-second spectral acceleration, g. From ISC-2017 Figure
   * 2-2/1(b), same caveat as `ss`. */
  s1: number;
  siteClass: IscSiteClass;
  occupancy: OccupancyCategory;
  /** Response modification coefficient. Free entry (§7.4/§11: only R=4,
   * intermediate RC moment frame, is verified against Appendix B — the
   * full Table 3-2/1 could not be extracted reliably, so this module never
   * ships a full R table, only the one verified value plus whatever the
   * engineer enters). */
  r: number;
}

/** The full parameter chain (§3.3), computed once per `SpectrumInputs`. */
export interface SpectrumParameters {
  fa: number;
  fv: number;
  sms: number;
  sm1: number;
  sds: number;
  sd1: number;
  /** Corner periods, seconds. `tl` is the ISC-2017 national constant (6 s,
   * §2-2/5) — always 6, never derived from `sds`/`sd1`, unlike `t0`/`ts`. */
  t0: number;
  ts: number;
  tl: number;
  importanceFactor: number;
  seismicDesignCategory: SeismicDesignCategory;
  /** `Cs = SDS / (R/I)` (eq. 3-9/2) — the code's unreduced base-shear
   * coefficient, constant in T. This is NOT the governing `Cs`: eq. 3-9/3's
   * `Cs <= SD1 / (T (R/I))` cap requires the structure's fundamental
   * period, which this calculator does not collect (§7.4 lists no
   * period/height input) — see `compute.ts`'s doc comment for the reasoned
   * scope cut. */
  csUnreduced: number;
  /** `Cs >= 0.044 SDS I` (eq. 3-9/4), no additional absolute floor —
   * ISC-2017 differs from ASCE 7 here (§3.3), do not add a `>= 0.01`
   * floor. */
  csFloor: number;
}

/** One `(T, Sa)` sample or exact corner point, for the chart and the
 * copy-to-clipboard series (§7.5). `isCornerPoint` marks the points the
 * export must include exactly rather than only on a uniform grid (§7.5:
 * "a spectrum resampled on a uniform grid that misses T0 and Ts has a
 * visibly wrong plateau"). */
export interface SpectrumPoint {
  t: number;
  sa: number;
  isCornerPoint: boolean;
}

export interface SpectrumCurve {
  /** The code (unreduced) curve, §3.2's four branches. */
  code: readonly SpectrumPoint[];
  /** `Sa(T) * I / R` — the behaviour-reduced curve an engineer actually
   * uses in a model (§7.2). */
  reduced: readonly SpectrumPoint[];
}
