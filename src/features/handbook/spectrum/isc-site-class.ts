import type { IscSiteClass } from "./types";

/**
 * ISC-2017 Table 7-1/1 site-class boundaries, derived from Vs30 alone.
 * DELIBERATELY separate from `handbook/site-class.ts`'s `ec8ClassFromVs30`
 * and `nehrpClassFromVs30` — this is not a reuse, and must not become one.
 *
 * `.claude/research/handbook-spectra-design.md` §3.6 is the reason: the
 * app's existing EC8 function has its C/D-equivalent boundary at 360 m/s
 * (EN 1998-1 Table 3.1's B/C line, actually); this function's C/D boundary
 * is ISC-2017's own **370 m/s**, appearing four independent times in the
 * code's extracted text ([P]). Feeding an EC8 letter into the ISC `Fa`/`Fv`
 * tables under-predicts short-period site amplification by 33% and
 * 1-second amplification by 41% for the single most common Iraqi site
 * condition (median grid Vs30 ~291 m/s lands EC8 "C" but ISC "D") — a
 * plausible wrong number, not a crash. See that document's §3.6 table for
 * the full boundary comparison.
 *
 * Class F ("requires site-specific investigation" — liquefiable soils,
 * highly organic soils/peat, very high plasticity clays, thick soft/medium
 * clays, Table 7-1/1 footnote) cannot be identified from Vs30 alone and is
 * never returned here; a Vs30-only tool can only ever place a point in
 * A-E, which is itself a real (documented) limitation, not a defect.
 *
 * Table 7-1/1 also carries the note: "where soil properties are not known
 * in sufficient detail to determine the site class, classify as D or E."
 * This function does not implement that fallback — it always classifies
 * FROM the sampled Vs30 it is given, per `HandbookLookupResult.siteClass`'s
 * existing "always derived from Vs30, never independently estimated"
 * convention (`types.ts`). The engineer-facing UI carries the "this is a
 * proxy, override it" framing instead (§6.1/§7.4).
 *
 * Boundary convention: the code's table prints ranges with a shared edge
 * value between adjacent rows ("760-1500" for B, "370-760" for C), which is
 * inherently ambiguous at the exact edge. This function resolves that edge
 * with `>` (strictly greater qualifies for the harder class), matching the
 * existing `nehrpClassFromVs30` in `handbook/site-class.ts` exactly except
 * for the C/D line moving from 360 to ISC-2017's own 370 — same style, so
 * a value sitting exactly on a shared boundary reads consistently across
 * both classification functions in this codebase, and always resolves to
 * the softer (more conservative) class, in the same spirit as the code's
 * own "classify as D or E when unknown" instinct.
 */
export function iscSiteClassFromVs30(vs30MS: number): IscSiteClass {
  if (vs30MS > 1500) return "A";
  if (vs30MS > 760) return "B";
  if (vs30MS > 370) return "C";
  if (vs30MS > 180) return "D";
  return "E";
}
