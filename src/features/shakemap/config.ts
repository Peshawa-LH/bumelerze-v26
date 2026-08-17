/**
 * Tunable engineering constants for the ShakeMap product pipeline (D14:
 * engineering-owned defaults, no science review needed) — mirrors
 * `features/events/config.ts`'s "one config module, never inlined" rule.
 */

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

/**
 * City-label visual styling (map-presentation wave, 2026-08-08 — owner:
 * "the cities are way too large in the text written and the labels are too
 * large and dark"). Previously inlined as bare numbers straight in
 * `ShakeMapView.tsx` (fontSize 9, strokeWidth 2, dot radius 2.5, fill
 * `colors.text.primary`) — pulled out to named constants so the sizing is
 * reviewable in one place and no future edit re-introduces a hardcoded
 * value. Values are in SVG viewBox units (same coordinate space as
 * `SHAKEMAP_VIEW_WIDTH`/`HEIGHT` above), deliberately smaller and lighter
 * than before; the fill color itself moved to `colors.text.secondary` (see
 * `ShakeMapView.tsx`), a step down from the near-black `text.primary` that
 * read as "too dark" against the map.
 */
export const SHAKEMAP_LABEL_FONT_SIZE = 7;
/** `fontWeight` is a string on `SvgText`, not a numeric config value here —
 * kept as "500" (medium) inline in `ShakeMapView.tsx`, matching
 * `typography.labelCaption`'s weight rather than the old default (unset ->
 * effectively regular/bold-by-renderer-default) so labels read as
 * deliberately lighter, not just smaller. */
export const SHAKEMAP_LABEL_HALO_WIDTH = 1.25;
export const SHAKEMAP_CITY_DOT_RADIUS = 1.75;

/**
 * Static basemap layer (map-presentation wave — owner: "there should be a
 * basemap similar to SHAKEmaps toolkit"): country border lines + coastline,
 * drawn under the intensity contours (`basemap/` fixture). Subtle by
 * design — this is context, not the map's own subject — and low-opacity
 * enough that a 60%-opacity contour fill painted on top still reads
 * clearly (wave brief: "contours keep their opacity so boundaries read
 * through").
 */
export const SHAKEMAP_BASEMAP_BORDER_WIDTH = 0.75;
export const SHAKEMAP_BASEMAP_COASTLINE_WIDTH = 0.75;
export const SHAKEMAP_BASEMAP_LINE_OPACITY = 0.6;

/**
 * Live product query cadence (`shakemap_products`, "closing the last gap"
 * wave) — deliberately NOT the feed/felt-map's active-polling cadence
 * (`events/config.ts`'s `EVENTS_REFETCH_INTERVAL_MS`, `feltmap/config.ts`'s
 * `FELTMAP_REFETCH_INTERVAL_MS`): a published `shakemap_products` row is
 * immutable per version (D9's own versioning discipline — a recompute is a
 * NEW row, never an edit of an existing one), so there is nothing to gain
 * from polling it on a fixed interval the way a live-updating feed or a
 * densifying felt-report count needs. No `refetchInterval` is set at all
 * (PROJECT.md "battery-conscious... no aggressive background polling") —
 * this stale time only controls how long a cached "did this event have a
 * live product" answer is trusted before a normal mount/foreground/
 * reconnect refetch is allowed to check again (e.g. a first compute
 * landing minutes after a user first opened Event Detail with nothing to
 * show yet).
 */
export const SHAKEMAP_LIVE_STALE_TIME_MS = 15 * 60 * 1000;
/** Keeps a resolved live product around across a short backgrounding/
 * screen revisit without a network round-trip — a day is generous and
 * harmless since the artifact itself never changes for a given version. */
export const SHAKEMAP_LIVE_GC_TIME_MS = 24 * 60 * 60 * 1000;
