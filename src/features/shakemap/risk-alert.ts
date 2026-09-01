/**
 * Building-damage alert band (owner: "a real risk dashboard with tags and
 * PAGER-style visuals... never casualties" — later refined: "don't make it
 * look like PAGER exactly, we should have a different style", so the
 * CONTENT below is PAGER-shaped (four qualitative severity bands from one
 * headline number) while the actual UI (`RiskDamageBandTag.tsx`) is drawn
 * in Bumelerze's own visual language, never PAGER's colored-banner look).
 *
 * Classified from the P50 (median) of buildings heavily damaged (DG3+) —
 * never from any casualty/fatality figure, which this app never computes-
 * for-display at all (D45). Thresholds are engineering defaults (D14: no
 * science-review checkpoint needed for a UI severity cut), deliberately
 * simple round numbers so the band a user sees is easy to reason about
 * ("under a hundred", "into the thousands", "tens of thousands or more").
 */

export type DamageBand = "green" | "yellow" | "orange" | "red";

/** Upper (exclusive) bound of the green band — below 100 heavily damaged
 * buildings. */
const GREEN_MAX = 100;
/** Upper (exclusive) bound of the yellow band — 100 to under 1,000. */
const YELLOW_MAX = 1_000;
/** Upper (exclusive) bound of the orange band — 1,000 to under 10,000;
 * 10,000 and above is red. */
const ORANGE_MAX = 10_000;

/**
 * Classifies the damage alert band from `buildingsHeavyP50` (the P50 of
 * `RiskSummary.buildingsHeavyP05P50P95`) — pure, no theme/i18n dependency,
 * so `RiskDamageBandTag.tsx` and `RiskProvinceList.tsx` (each province row
 * gets its own band, from its own P50) both classify through the exact
 * same rule and can never disagree on where a value falls.
 */
export function classifyDamageBand(buildingsHeavyP50: number): DamageBand {
  if (buildingsHeavyP50 < GREEN_MAX) {
    return "green";
  }
  if (buildingsHeavyP50 < YELLOW_MAX) {
    return "yellow";
  }
  if (buildingsHeavyP50 < ORANGE_MAX) {
    return "orange";
  }
  return "red";
}

/** Fixed band order, worst-last — shared by anything that needs to iterate
 * every band (e.g. a future legend), so the order is defined exactly
 * once. */
export const DAMAGE_BAND_ORDER: readonly DamageBand[] = ["green", "yellow", "orange", "red"];
