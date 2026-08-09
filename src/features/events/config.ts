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

/** EMSC endpoint (teardown-lastquake.md §2: "EMSC exposes the same FDSN
 * standard as USGS" — same query params, same bbox/time filters). Used only
 * as the region feed's fallback provider (D4 second tier) when USGS is slow
 * or unreachable; there is no EMSC equivalent wired for the world feed (see
 * `fetchUsgsWorldEvents` in usgs.ts for why). */
export const EMSC_FEEDS = {
  fdsnQuery: "https://www.seismicportal.eu/fdsnws/event/1/query",
} as const;

/** Region feed window per the wave brief: last 30 days. */
export const REGION_FEED_WINDOW_DAYS = 30;

/** Polling cadence — deliberately gentle (PROJECT.md: no aggressive
 * background polling); pairs with the app-focus-aware refetch wiring in
 * queries.ts so this interval never fires while the app is backgrounded. */
export const EVENTS_REFETCH_INTERVAL_MS = 60_000;
export const EVENTS_STALE_TIME_MS = 30_000;

/** How long the region feed waits on USGS before treating it as unreachable
 * and failing over to EMSC (D4 second tier — "a real scenario on regional
 * networks"). Tunable; 8s is generous for a mobile network but still well
 * under a user's patience for a pull-to-refresh. */
export const USGS_REGION_TIMEOUT_MS = 8_000;
