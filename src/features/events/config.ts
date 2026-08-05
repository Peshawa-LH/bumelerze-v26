/**
 * Tunable engineering constants for the events pipeline (D14: engineering-owned
 * defaults, no science review needed). Kept in one config module, never
 * inlined in fetch/normalize code, per PROJECT.md's provider-normalization
 * gotcha and event-pipeline-design.md's own "stored in config, not code"
 * instruction for the region bbox.
 */

/**
 * "Region" bbox per event-pipeline-design.md §4: Kurdistan Region + border
 * Zagros both sides + Mosul/Kirkuk, deliberately generous eastward (Iranian
 * events are felt in Slemani). Tunable.
 */
export const REGION_BBOX = {
  minLat: 33.0,
  maxLat: 38.5,
  minLon: 41.0,
  maxLon: 48.5,
} as const;

/**
 * Distance-anchor cities used when we have no location permission (this
 * wave never requests one — spec-v1.md §4.1 "no-permission" state). Order
 * doesn't matter; `nearestAnchor` picks the closest for a given event.
 */
export interface RegionAnchor {
  id: "erbil" | "slemani" | "duhok";
  /** i18n key for the display name — never a hard-coded city string. */
  nameKey: string;
  lat: number;
  lon: number;
}

export const REGION_ANCHORS: readonly RegionAnchor[] = [
  { id: "erbil", nameKey: "events.anchors.erbil", lat: 36.19, lon: 44.01 },
  { id: "slemani", nameKey: "events.anchors.slemani", lat: 35.56, lon: 45.43 },
  { id: "duhok", nameKey: "events.anchors.duhok", lat: 36.87, lon: 42.99 },
];

/**
 * Significance-score classification thresholds, event-pipeline-design.md §3.
 * All tunable; region-significant deliberately aligns with the shake-service
 * M>=3.5 trigger band (D9).
 */
export const SIGNIFICANCE_THRESHOLDS = {
  regionSignificant: 350,
  worldSignificant: 600,
} as const;

/**
 * USGS PAGER alert-level bonus feeding the client-side `sig` approximation
 * (event-pipeline-design.md §3). USGS `properties.alert` is `null` for most
 * events (no PAGER product) — treated as the "green"/no-bonus case.
 */
export const ALERT_BONUS: Record<string, number> = {
  green: 0,
  yellow: 100,
  orange: 200,
  red: 300,
};

/** USGS endpoints (teardown-usgs-dyfi.md §2). fdsnws for the region query
 * (bbox/time filters), the CDN summary feed for a cheap world snapshot. */
export const USGS_FEEDS = {
  fdsnQuery: "https://earthquake.usgs.gov/fdsnws/event/1/query",
  worldSummary:
    "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson",
  /** Single-event lookup, used for cold-start deep links not yet in cache. */
  fdsnEvent: "https://earthquake.usgs.gov/fdsnws/event/1/query",
} as const;

/** Region feed window per the wave brief: last 30 days. */
export const REGION_FEED_WINDOW_DAYS = 30;

/** Polling cadence — deliberately gentle (PROJECT.md: no aggressive
 * background polling); pairs with the app-focus-aware refetch wiring in
 * queries.ts so this interval never fires while the app is backgrounded. */
export const EVENTS_REFETCH_INTERVAL_MS = 60_000;
export const EVENTS_STALE_TIME_MS = 30_000;
