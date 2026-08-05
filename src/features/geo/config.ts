/**
 * Tunable constants for the geo/gazetteer module (D14: engineering-owned
 * defaults). Kept separate from `events/config.ts`'s `REGION_BBOX` — that
 * one drives event significance classification (event-pipeline-design.md
 * §4) and is deliberately generous; this bbox is the "is this point inside
 * the Kurdistan Region" check for place-line region labeling
 * (ui-backlog.md wave 5 item 4), so it's drawn tighter, roughly tracing the
 * KRG-administered governorates (Duhok, Erbil, Sulaymaniyah incl. Halabja/
 * Garmian) rather than the whole greater-Kurdistan/Zagros catchment.
 *
 * A bbox is an explicit simplification of the real (non-rectangular) KRG
 * boundary — per the wave-5 brief's own allowance ("a simple polygon/bbox
 * check"). It will misclassify a handful of edge points near the border
 * (e.g. it doesn't carve out federally-administered Kirkuk city, which
 * sits inside this rectangle) — `placeLine` compensates for the common
 * cases by also trusting each gazetteer city's own `inKurdistanRegion`
 * flag first; this bbox is only the fallback for events whose nearest
 * gazetteer city has no flag opinion nearby. Tunable; revisit with a real
 * polygon once Phase 3's MapLibre integration makes that cheap to draw.
 */
export const KURDISTAN_REGION_BBOX = {
  minLat: 34.3,
  maxLat: 37.5,
  minLon: 42.2,
  maxLon: 46.3,
} as const;

/** `placeLine` falls back to the raw provider place string beyond this
 * distance from the nearest gazetteer city (ui-backlog.md wave 5 item 4:
 * "farther world events keep the USGS string as fallback"). */
export const NEAREST_CITY_FALLBACK_THRESHOLD_KM = 300;

/** Default city count for the event-detail "nearest cities" list
 * (ui-backlog.md wave 5 item 5: "list of the 3 nearest gazetteer
 * cities"). */
export const DEFAULT_NEAREST_CITY_COUNT = 3;
