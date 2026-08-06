/**
 * Tunable engineering constants for the ShakeMap product pipeline (D14:
 * engineering-owned defaults, no science review needed) — mirrors
 * `features/events/config.ts`'s "one config module, never inlined" rule.
 */

/** fdsnws single-event detail endpoint (geojson `detail` format), the same
 * shape teardown-usgs-dyfi.md §2 documents for `properties.products.*`.
 * Deliberately a private constant here rather than importing
 * `features/events/config.ts`'s `USGS_FEEDS` — this feature owns its own
 * USGS product-extraction surface end to end (PROJECT.md gotcha: don't
 * scatter feed-specific parsing, but also don't couple unrelated features
 * through a shared endpoint constant that happens to have the same value
 * today for different reasons). */
export const USGS_EVENT_DETAIL_ENDPOINT =
  "https://earthquake.usgs.gov/fdsnws/event/1/query";

/** Bounding-box padding around the contour extent, as a fraction of the
 * (post-longitude-correction) span on each axis — keeps the outermost
 * contour ring from touching the SVG edge and leaves room for city dots
 * just outside the highest-intensity ring. */
export const SHAKEMAP_BBOX_PADDING_RATIO = 0.15;

/** Fallback padding in degrees when the contour set collapses to a single
 * point (a pathological/degenerate product) and the span-based padding
 * above would be zero. */
export const SHAKEMAP_BBOX_MIN_PADDING_DEG = 0.25;

/** Logical SVG viewBox size (not device pixels — `ShakeMapView` renders at
 * `width="100%"` with this aspect via `viewBox`). 4:3-ish, generous enough
 * for the legend strip below the map itself. */
export const SHAKEMAP_VIEW_WIDTH = 320;
export const SHAKEMAP_VIEW_HEIGHT = 240;

/** Max gazetteer city dots drawn on the map (wave brief point 2 — "max ~5
 * in-bbox cities"). */
export const SHAKEMAP_MAX_CITIES = 5;

/** Perf guard for low-end Android (PROJECT.md "target 60 FPS on low-end
 * Android... keep the JS bundle lean"): a single USGS MMI level can carry
 * dozens of contour rings (coastline-like detail at the outer, lowest
 * levels). Rendering every ring of every level as its own SVG `Polygon` is
 * the single biggest cost in this component, so each level's ring list is
 * capped — the largest (most area-significant) rings are kept, tiny
 * fragments dropped, via `contours.ts`'s ring-size sort. */
export const SHAKEMAP_MAX_RINGS_PER_LEVEL = 40;

/** Rings with fewer than this many points cover negligible area and are
 * dropped outright before the cap above ever applies. */
export const SHAKEMAP_MIN_RING_POINTS = 3;
