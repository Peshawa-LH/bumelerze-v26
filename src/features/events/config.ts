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
 * standard as USGS" — same query params, same bbox/time filters). Queried
 * in parallel with USGS for the region feed's completeness merge (merge.ts:
 * EMSC catalogs regional events below USGS/NEIC's ~M4.5 completeness
 * threshold); there is no EMSC equivalent wired for the world feed (see
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

/** Per-provider timeout budgets for the region feed's PARALLEL USGS+EMSC
 * fetch (completeness merge — see queries.ts). Each provider gets its own
 * abort budget; a slow provider is dropped from that poll's merge rather
 * than blocking the other one. Tunable; 8s is generous for a mobile network
 * but still well under a user's patience for a pull-to-refresh. */
export const USGS_REGION_TIMEOUT_MS = 8_000;
export const EMSC_REGION_TIMEOUT_MS = 8_000;

/**
 * Cross-provider dedup thresholds, event-pipeline-design.md §2 step 3
 * (spatial-temporal match, all tunable): two provider records are the same
 * physical earthquake when |Δ origin time| <= 16 s AND epicentral distance
 * <= 100 km AND |ΔM| <= 1.5 (the magnitude guard applies only when both
 * records carry a magnitude — in the client's normalized `Event` model both
 * always do, since normalize.ts drops magnitude-less features). Mirrored by
 * the shake-service worker's own dedup helper (feed_watcher.py) — keep the
 * two in sync when tuning.
 */
export const DEDUP_MAX_TIME_DELTA_MS = 16_000;
export const DEDUP_MAX_DISTANCE_KM = 100;
export const DEDUP_MAX_MAG_DELTA = 1.5;
