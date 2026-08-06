/**
 * MMI value -> EMS-98/MMI ramp index (D7: `theme.colors.intensity[1..12]`,
 * "swappable palette... never hardcoded hexes"). Shared by `contours.ts`
 * (assigns each contour level a ramp index) and `ShakeMapView`/the legend
 * (reads the same ramp by index) so the two never drift.
 */
const MIN_LEVEL = 1;
const MAX_LEVEL = 12;

export function mmiValueToLevel(value: number): number {
  return Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, Math.round(value)));
}

/** Roman numerals for ramp indices 1..12 (index 0 unused, mirroring the
 * theme ramp's own "index 0 unused" convention) — the legend's display
 * convention for MMI/EMS-98 intensity (USGS ShakeMap legends, EMS-98
 * publications), distinct from the felt-report tier-1 cartoons which show
 * plain localized digits (`LevelTile`) rather than Roman numerals. */
export const INTENSITY_ROMAN_NUMERALS: readonly string[] = [
  "",
  "I",
  "II",
  "III",
  "IV",
  "V",
  "VI",
  "VII",
  "VIII",
  "IX",
  "X",
  "XI",
  "XII",
];
