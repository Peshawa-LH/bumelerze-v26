/**
 * Conservative, magnitude-only visual accent for an event card's edge
 * stripe.
 *
 * This is deliberately NOT an intensity mapping. design-language.md §3.2 is
 * explicit that magnitude must always render in neutral text color and that
 * only felt-impact/shakemap-derived intensity may drive color — conflating
 * the two is named as LastQuake's own card-design mistake. A magnitude is
 * one number for the whole earthquake; what a person feels depends on
 * distance and depth. So the stripe borrows the intuitive cool-to-hot
 * ORDER of a shaking scale without borrowing the EMS-98 ramp's colors
 * (`theme/palette.ts`'s `magnitudeBandPalette` documents the separation and
 * the contrast figures), and the numeral beside it stays neutral text.
 *
 * The bands are the standard USGS magnitude classes, so they carry a
 * meaning a reader can recognise rather than edges invented for this app,
 * and whole-number edges let someone place an event from the numeral
 * alone.
 *
 * Owner directive 2026-09-23, replacing three bands at 4.5/6.0. Those put
 * 86% of every browsable event into one color and rendered an M6.0
 * identically to an M7.8 — the distinction that matters most in a region
 * whose reference earthquakes are the 2017 (M7.3) and 2023 (M7.8) events.
 */
export type MagnitudeBand = "minor" | "light" | "moderate" | "strong" | "major";

/** Kept as the old name so the call sites and their tests stay honest
 * about what this is: a tone, not a severity. */
export type MagnitudeTone = MagnitudeBand;

/**
 * USGS magnitude class for a value. Ascending edges, checked descending so
 * the boundary itself belongs to the HIGHER band: an M6.0 is strong, not
 * moderate.
 */
export function magnitudeTone(magnitudeValue: number): MagnitudeBand {
  if (magnitudeValue >= 7) {
    return "major";
  }
  if (magnitudeValue >= 6) {
    return "strong";
  }
  if (magnitudeValue >= 5) {
    return "moderate";
  }
  if (magnitudeValue >= 4) {
    return "light";
  }
  return "minor";
}
