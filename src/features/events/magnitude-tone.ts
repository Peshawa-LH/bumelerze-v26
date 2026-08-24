/**
 * TODO(felt-impact-colors): conservative, magnitude-only visual accent.
 *
 * This is deliberately NOT an intensity mapping. design-language.md §3.2 is
 * explicit that magnitude must always render in neutral text color and that
 * only felt-impact/shakemap-derived intensity may drive color — conflating
 * the two is named as LastQuake's own card-design mistake. We have no
 * felt-impact or shakemap data yet (Phase 2/3), so `EventCard` cannot show
 * a real `IntensityBadge`.
 *
 * What this DOES do: pick one of the app's existing neutral `status.*`
 * tokens (not the EMS-98 `intensity` ramp) as a coarse "how big" accent —
 * a thin border stripe, nothing claiming to be a scientific severity
 * estimate. Replace this whole module with real intensity-badge coloring
 * once Phase 2/3 ships felt reports / shakemap output; the magnitude
 * numeral itself must stay neutral forever regardless (design-language.md
 * §3.2 is a hard rule, not a placeholder).
 */
export type MagnitudeTone = "info" | "warning" | "danger";

export function magnitudeTone(magnitudeValue: number): MagnitudeTone {
  if (magnitudeValue >= 6) {
    return "danger";
  }
  if (magnitudeValue >= 4.5) {
    return "warning";
  }
  return "info";
}
