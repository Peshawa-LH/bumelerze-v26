/**
 * Tunable engineering constants for the felt-map display (D14: engineering-
 * owned defaults, no science review needed) — mirrors `features/shakemap
 * /config.ts`'s "one config module, never inlined" rule.
 */

/** Same logical SVG viewBox size as `shakemap/config.ts`'s
 * `SHAKEMAP_VIEW_WIDTH`/`HEIGHT` — kept as an intentionally duplicated
 * literal (not a cross-import) so the two features' sizing can be tuned
 * independently later without one silently dragging the other along; the
 * wave brief's "feel like a sibling" goal is about the two sections reading
 * the same, not about hard-coupling their config modules together. */
export const FELTMAP_VIEW_WIDTH = 320;
export const FELTMAP_VIEW_HEIGHT = 240;

/** Same padding rationale as `SHAKEMAP_BBOX_PADDING_RATIO`/`_MIN_PADDING_DEG`
 * — keeps the outermost cell from touching the SVG edge. */
export const FELTMAP_BBOX_PADDING_RATIO = 0.15;
export const FELTMAP_BBOX_MIN_PADDING_DEG = 0.25;

/** Max gazetteer city dots drawn on the map — same default as
 * `SHAKEMAP_MAX_CITIES`. */
export const FELTMAP_MAX_CITIES = 5;

/** React Query cadence: same 60s/30s rhythm as the region event feed
 * (`EVENTS_REFETCH_INTERVAL_MS`/`EVENTS_STALE_TIME_MS`) so the felt map
 * densifies at roughly the same pace a user watching Event Detail already
 * expects from the rest of the screen (spec-v1.md §4.1 user journey: "watches
 * the felt map densify in near-real-time"). Only polls while the screen is
 * mounted and the app is foregrounded (React Query's own
 * `refetchIntervalInBackground: false` plus the app-wide `focusManager`
 * wiring `events/queries.ts` already attaches once per app instance) — no
 * extra battery cost beyond what the feed already pays (PROJECT.md:
 * "no aggressive background polling"). */
export const FELTMAP_REFETCH_INTERVAL_MS = 60_000;
export const FELTMAP_STALE_TIME_MS = 30_000;
