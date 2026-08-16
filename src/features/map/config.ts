/**
 * Tunable constants for the web map (Map tab, web-first wave). Web only —
 * see `app/(tabs)/map.web.tsx`'s doc comment for why the interactive map is
 * gated to the web platform this wave.
 */

/**
 * OpenFreeMap (https://openfreemap.org) style URLs — free, no API key, no
 * signup, per PROJECT.md's "boring, well-documented" preference and the
 * wave brief's explicit basemap choice. Verified live (2026-08-16: both
 * URLs return `200 application/json` style documents) rather than assumed
 * from docs. Picked by the app's active color scheme (`useTheme().scheme`),
 * matching the app's own dark-is-primary convention (design-language.md
 * §4) instead of always shipping one style.
 */
export const MAP_STYLE_URLS = {
  light: "https://tiles.openfreemap.org/styles/liberty",
  dark: "https://tiles.openfreemap.org/styles/dark",
} as const;

/**
 * OpenFreeMap's style documents carry no `attribution` string on their
 * sources (verified live against the `liberty`/`dark` styles above), so
 * MapLibre's default `AttributionControl` would render empty — this is the
 * explicit credit line openfreemap.org's own site uses under its preview
 * map ("OpenFreeMap © OpenMapTiles Data from OpenStreetMap"), wired in as
 * `AttributionControl`'s `customAttribution` so it's always visible
 * (wave brief: "REQUIRED: visible attribution... do not hide it").
 */
export const MAP_ATTRIBUTION_HTML =
  '<a href="https://openfreemap.org" target="_blank" rel="noopener noreferrer">OpenFreeMap</a> ' +
  '© <a href="https://openmaptiles.org" target="_blank" rel="noopener noreferrer">OpenMapTiles</a> ' +
  'Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>';

/** Marker visual size range, magnitude-scaled (marker-helpers.ts). Kept
 * modest — a full-screen map showing dozens of the 30-day region window's
 * events must stay legible, not turn into a field of giant circles. */
export const MARKER_MIN_DIAMETER_PX = 14;
export const MARKER_MAX_DIAMETER_PX = 34;

/** Magnitude clamp bounds feeding the linear diameter interpolation —
 * events below `MARKER_MAGNITUDE_FLOOR` all render at the minimum size,
 * events at/above `MARKER_MAGNITUDE_CEILING` all render at the maximum
 * (event-pipeline-design.md territory doesn't fix a display ceiling, so
 * this is an engineering default, D14). */
export const MARKER_MAGNITUDE_FLOOR = 0;
export const MARKER_MAGNITUDE_CEILING = 7;

/** Extra invisible padding around each marker's visible dot, widening the
 * clickable/tappable area beyond what the small dot itself would give —
 * "big touch targets on markers (extra hit radius)" (wave brief,
 * panic-time UX). Applied symmetrically, so the hit target is always
 * `diameter + 2 * MARKER_HIT_PADDING_PX` on each side. */
export const MARKER_HIT_PADDING_PX = 10;

/** Padding (px) around the fitted region bbox so edge markers aren't
 * clipped by the viewport/screen edge on initial load. */
export const MAP_FIT_BOUNDS_PADDING_PX = 32;
