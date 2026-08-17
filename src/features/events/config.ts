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

/** GEOFON (GFZ Helmholtz Centre for Geosciences, Potsdam) fdsnws endpoint —
 * the third region-feed catalog (D4 authority order: USGS > EMSC > GEOFON).
 * FDSN-compliant but with NO `format=json` support (verified live: 400) —
 * `format=text` is what it speaks: pipe-delimited FDSN WS-EVENT text, parsed
 * by geofon.ts. Same bbox filter params as EMSC's short aliases
 * (minlat/maxlat/minlon/maxlon) plus `starttime`. */
export const GEOFON_FEEDS = {
  fdsnQuery: "https://geofon.gfz.de/fdsnws/event/1/query",
} as const;

/**
 * Region feed FETCH window (what USGS+EMSC+GEOFON are actually queried
 * for, every poll — queries.ts's `fetchRegionEventsMerged`). Widened from
 * the original flat 30 days to 180 (owner 2026-08-17, update-plan-2026-08.md
 * §1.1: "what if there are lots of events, or not so much... should we show
 * the last 6 months or just 3 months") so the client always holds a
 * superset the ADAPTIVE HOME-FEED POLICY below (`home-feed-policy.ts`) can
 * pick a narrower DISPLAY window from, entirely client-side, with no extra
 * network round trip on the sparse-widen path. 180 days is also exactly the
 * sparse-widen ladder's own cap (`HOME_FEED_WINDOW_STEPS_DAYS`) and covers
 * the M>=5 "stays longer" notable tier (`HOME_FEED_NOTABLE_TIERS`) in full,
 * so ONE pool serves both mechanisms.
 *
 * Bandwidth tradeoff, explicit: this is a 6x fetch-size increase over the
 * old 30-day window, still unfiltered by magnitude (PROJECT.md: no
 * aggressive background polling, but this is payload SIZE per poll, not
 * poll FREQUENCY — the 60s cadence in EVENTS_REFETCH_INTERVAL_MS is
 * unchanged). Accepted as the boring/simple option for this wave (one
 * query, one cache key, no new plumbing); the M>=6 "12 months" notable
 * tier deliberately does NOT extend this hot-path window further — see
 * `NOTABLE_TAIL_*` below for how that tail is covered instead, at far
 * lower bandwidth cost. Revisit only if a real device measurement shows
 * this window is a problem in practice.
 */
export const REGION_FEED_WINDOW_DAYS = 180;

/**
 * Home DISPLAY floor (owner directive 2026-08-16): the Home list shows only
 * events people plausibly felt — EMSC's dense Turkish-network coverage
 * otherwise fills the screen with M<2 micro-events and buries the ones that
 * matter ("Home should be: user enters and sees important events with
 * effects on Kurdistan"). Display-level ONLY: the region feed still fetches
 * and caches everything below the floor — the felt-report association,
 * event detail deep links, upcoming crowdsourced-detection matching, and the
 * catalog all keep seeing the full feed. This is also the BASELINE
 * magnitude floor and the first (loosest) rung of
 * `HOME_FEED_MAGNITUDE_FLOOR_STEPS` below.
 */
export const HOME_FEED_MIN_MAGNITUDE = 3.0;

/**
 * Adaptive Home-feed policy (owner 2026-08-17, update-plan-2026-08.md §1.1:
 * "we should have a mechanism so it is not left empty and not overclogged").
 * Pure decision logic lives in `home-feed-policy.ts`'s `selectHomeFeedEvents`
 * — this module only holds the tunable thresholds (D14: engineering-owned
 * defaults, no science review needed), so the policy stays testable via
 * fixtures without touching a live query.
 *
 * FUTURE (recorded, explicitly NOT built this wave): an operator-controlled
 * "crisis mode" override for aftershock sequences — owner: "in case a big
 * event happens in Kurdistan with aftershocks happening, then probably we
 * need a more manual entry or setting controlled from our side." Parked
 * until an admin/operator surface exists (same category as the D15
 * moderation-dashboard precedent) — revisit when a real sequence demands
 * it, not speculatively.
 */

/** Sparse-feed widen ladder — the policy tries these lookback windows, in
 * order, at the BASELINE magnitude floor, and stops at the first one that
 * meets `HOME_FEED_MIN_CARDS`. The first entry MUST equal the baseline
 * (30 days); the last is the hard cap the policy never widens past on this
 * path (only the notable-tier carve-out below can surface something
 * older). Tunable engineering default. */
export const HOME_FEED_WINDOW_STEPS_DAYS = [30, 60, 90, 180] as const;

/** Below this many cards at a given window/floor combination, Home is
 * "too empty" and the sparse-widen ladder kicks in. Tunable engineering
 * default — deliberately small: Home is a panic-time screen, a handful of
 * real regional cards is already a meaningful, non-empty feed. */
export const HOME_FEED_MIN_CARDS = 5;

/** Above this many cards, Home is "overclogged" and the dense-tighten
 * ladder raises the magnitude floor (never shortens the window — recency
 * stays intact, noise gets trimmed instead, per the owner's own framing).
 * Tunable engineering default. */
export const HOME_FEED_MAX_CARDS = 40;

/** Dense-feed magnitude-floor ladder, applied AFTER the window is resolved
 * by the sparse-widen step above. The first rung MUST equal
 * `HOME_FEED_MIN_MAGNITUDE` (today's shipped floor) so the "no adaptive
 * change needed" case reproduces the exact current behavior; the policy
 * only climbs further if the previous rung is still over
 * `HOME_FEED_MAX_CARDS`. Tunable engineering default. */
export const HOME_FEED_MAGNITUDE_FLOOR_STEPS = [
  HOME_FEED_MIN_MAGNITUDE,
  3.5,
  4.0,
] as const;

export interface HomeFeedNotableTier {
  minMagnitude: number;
  retentionDays: number;
}

/**
 * Magnitude-tiered retention — the "high-magnitude events in Kurdistan
 * should stay longer" ask, independent of the window/floor mechanism
 * above: merged into the same Home list as a carve-out, matched regardless
 * of how old the event is (bounded only by `retentionDays`). Tunable
 * engineering defaults; owner-recommended values used verbatim (M>=5 for
 * ~6 months, M>=6 for ~12 months).
 *
 * The M>=5/180-day tier is fully covered by the region feed's own fetch
 * pool (`REGION_FEED_WINDOW_DAYS` above, also 180) — no extra query. The
 * M>=6/365-day tier reaches further back than that pool goes, so it is
 * backed by a SEPARATE, low-frequency, server-side-magnitude-filtered
 * query (`NOTABLE_TAIL_*` below + `fetchUsgsNotableTailEvents` in
 * usgs.ts) rather than by further widening the hot 60s-cadence pool — M>=6
 * events in this region are rare enough that a small, rarely-refetched
 * single-provider query is the battery/bandwidth-appropriate way to cover
 * that last stretch, per PROJECT.md's "no aggressive background polling."
 */
export const HOME_FEED_NOTABLE_TIERS: readonly HomeFeedNotableTier[] = [
  { minMagnitude: 5.0, retentionDays: 182 }, // ~6 months
  { minMagnitude: 6.0, retentionDays: 365 }, // ~12 months
];

/** Lowest magnitude among `HOME_FEED_NOTABLE_TIERS` whose retention window
 * exceeds `REGION_FEED_WINDOW_DAYS` — i.e. the floor the notable-tail query
 * needs to fetch server-side so it (and only it) covers the gap the hot
 * region-feed pool doesn't reach. Kept as its own constant (rather than
 * derived at call time) so the notable-tail query's intent reads plainly
 * at the call site in usgs.ts/queries.ts. */
export const NOTABLE_TAIL_MIN_MAGNITUDE = 6.0;

/** Lookback window for the notable-tail query — matches the longest
 * `HOME_FEED_NOTABLE_TIERS.retentionDays` (365, the M>=6 tier). */
export const NOTABLE_TAIL_WINDOW_DAYS = 365;

/** The notable-tail query is refetched only on mount/app-foreground, not on
 * a fixed interval (no `refetchInterval` set for it in queries.ts) — a
 * long `staleTime` is the only cadence control it needs, since a FRESH
 * M>=6 event is already inside the hot region-feed pool's 180-day window
 * (and shows immediately via the normal display floor) the moment it
 * happens; this query's only job is backfilling the 180-365 day tail,
 * which changes on the order of years, not minutes. */
export const NOTABLE_TAIL_STALE_TIME_MS = 12 * 60 * 60 * 1000; // 12h

/** Polling cadence — deliberately gentle (PROJECT.md: no aggressive
 * background polling); pairs with the app-focus-aware refetch wiring in
 * queries.ts so this interval never fires while the app is backgrounded. */
export const EVENTS_REFETCH_INTERVAL_MS = 60_000;
export const EVENTS_STALE_TIME_MS = 30_000;

/** Per-provider timeout budgets for the region feed's PARALLEL
 * USGS+EMSC+GEOFON fetch (completeness merge — see queries.ts). Each
 * provider gets its own abort budget; a slow provider is dropped from that
 * poll's merge rather than blocking the others. Tunable; 8s is generous for
 * a mobile network but still well under a user's patience for a
 * pull-to-refresh. */
export const USGS_REGION_TIMEOUT_MS = 8_000;
export const EMSC_REGION_TIMEOUT_MS = 8_000;
export const GEOFON_REGION_TIMEOUT_MS = 8_000;

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

/**
 * Possible-events read (D26 item 3, `possible.ts`): matches the server-side
 * expiry window (supabase/migrations/0012_crowd_detection.sql
 * `expire_stale_possible_events`, 24h) so the client never queries further
 * back than a row could still carry `status = 'possible'`. Refetch cadence
 * deliberately faster than the region feed's 60s (same value, actually) —
 * kept as its own constant rather than reusing EVENTS_REFETCH_INTERVAL_MS
 * so the two can be tuned independently later (this is a much smaller,
 * cheaper query).
 */
export const POSSIBLE_EVENTS_WINDOW_HOURS = 24;
export const POSSIBLE_EVENTS_REFETCH_INTERVAL_MS = 60_000;
