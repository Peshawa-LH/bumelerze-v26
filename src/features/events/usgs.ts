import {
  NOTABLE_TAIL_MIN_MAGNITUDE,
  NOTABLE_TAIL_WINDOW_DAYS,
  REGION_BBOX,
  REGION_FEED_WINDOW_DAYS,
  USGS_FEEDS,
} from "./config";
import { normalizeUsgsFeature } from "./normalize";
import {
  usgsFeatureCollectionSchema,
  usgsFeatureSchema,
} from "./usgs-schema";
import type { Event } from "./types";

export interface UsgsFetchResult {
  events: Event[];
  /** Count of features present in the response but skipped (failed schema
   * validation, or a null/unusable magnitude) — logged, never thrown, so a
   * handful of malformed USGS records never crash the feed (wave brief:
   * "tolerant parsing... bad individual features skipped with a counted
   * warning, never a crash"). */
  skippedCount: number;
  fetchedAt: number;
}

/** Parses a raw USGS GeoJSON FeatureCollection payload into normalized
 * events, tolerantly. A malformed top-level payload (not even a valid
 * FeatureCollection shape) still throws — there's nothing tolerant to do
 * with a response that isn't GeoJSON at all; the caller (React Query) turns
 * that into the query's error state. */
function parseFeatureCollection(
  payload: unknown,
  fetchedAt: number,
): UsgsFetchResult {
  const collection = usgsFeatureCollectionSchema.parse(payload);

  const events: Event[] = [];
  let skippedCount = 0;

  for (const rawFeature of collection.features) {
    const parsed = usgsFeatureSchema.safeParse(rawFeature);
    if (!parsed.success) {
      skippedCount += 1;
      if (__DEV__) {
        console.warn(
          "[events/usgs] skipped a feature that failed schema validation",
          parsed.error.issues[0],
        );
      }
      continue;
    }

    const event = normalizeUsgsFeature(parsed.data, fetchedAt);
    if (!event) {
      skippedCount += 1;
      continue;
    }

    events.push(event);
  }

  return { events, skippedCount, fetchedAt };
}

async function fetchJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(url, signal ? { signal } : {});
  if (!response.ok) {
    throw new Error(`USGS request failed: ${response.status} ${url}`);
  }
  return response.json();
}

interface RegionQueryOptions {
  windowDays: number;
  /** Server-side `minmagnitude` filter — omitted entirely (no floor) when
   * `undefined`, matching the hot region feed's existing unfiltered
   * behavior. */
  minMagnitude?: number;
}

function buildRegionQueryUrl({ windowDays, minMagnitude }: RegionQueryOptions): string {
  const startTime = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();

  const params = new URLSearchParams({
    format: "geojson",
    starttime: startTime,
    minlatitude: String(REGION_BBOX.minLat),
    maxlatitude: String(REGION_BBOX.maxLat),
    minlongitude: String(REGION_BBOX.minLon),
    maxlongitude: String(REGION_BBOX.maxLon),
    orderby: "time",
  });
  if (minMagnitude !== undefined) {
    params.set("minmagnitude", String(minMagnitude));
  }

  return `${USGS_FEEDS.fdsnQuery}?${params.toString()}`;
}

/** Region feed: fdsnws query, last `REGION_FEED_WINDOW_DAYS` (config.ts),
 * bbox from config.ts (event-pipeline-design.md §4), no magnitude floor —
 * the adaptive Home-feed policy (`home-feed-policy.ts`) applies its own
 * display floor client-side over this pool. `signal` is used by
 * queries.ts's parallel USGS+EMSC+GEOFON completeness merge
 * (config.USGS_REGION_TIMEOUT_MS) to abort a slow USGS request without
 * blocking the other legs — optional so every existing direct caller (and
 * every existing test) is unaffected. */
export async function fetchUsgsRegionEvents(signal?: AbortSignal): Promise<UsgsFetchResult> {
  const payload = await fetchJson(
    buildRegionQueryUrl({ windowDays: REGION_FEED_WINDOW_DAYS }),
    signal,
  );
  return parseFeatureCollection(payload, Date.now());
}

/**
 * Notable-tail region feed (config.ts `NOTABLE_TAIL_*`, update-plan-2026-08.md
 * §1.1): backfills the M>=6/12-month "stays longer" tier that
 * `fetchUsgsRegionEvents`'s own `REGION_FEED_WINDOW_DAYS` pool doesn't
 * reach. Server-side `minmagnitude` filter keeps this response tiny
 * (regional M>=6 events are rare), and it's USGS-only — deliberately not
 * merged with EMSC/GEOFON, the same reasoning as `fetchUsgsWorldEvents`'s
 * own doc comment: the completeness gap the multi-provider merge exists to
 * fix is a below-M4.5 phenomenon, not a concern at M>=6. Polled rarely (no
 * `refetchInterval`, a long `staleTime` — see queries.ts), not every 60s
 * like the hot region feed.
 */
export async function fetchUsgsNotableTailEvents(
  signal?: AbortSignal,
): Promise<UsgsFetchResult> {
  const payload = await fetchJson(
    buildRegionQueryUrl({
      windowDays: NOTABLE_TAIL_WINDOW_DAYS,
      minMagnitude: NOTABLE_TAIL_MIN_MAGNITUDE,
    }),
    signal,
  );
  return parseFeatureCollection(payload, Date.now());
}

/** World feed: the CDN-cached M4.5+/week summary feed — cheap, no bbox/time
 * filters needed (teardown-usgs-dyfi.md §2). Deliberately USGS-only — the
 * EMSC completeness merge applies to the REGION feed only: the world feed's
 * own M4.5 floor matches USGS/NEIC's global completeness, so EMSC has
 * nothing systematic to add there (the completeness gap the merge fixes is
 * a below-M4.5 REGIONAL phenomenon), EMSC has no equivalent pre-built CDN
 * summary file (an EMSC world query would be uncached and unbounded — much
 * heavier than this cheap static file), and a stale/missing world catalog
 * isn't a safety-path scenario. Revisit only if the world feed itself
 * becomes safety-critical. */
export async function fetchUsgsWorldEvents(): Promise<UsgsFetchResult> {
  const payload = await fetchJson(USGS_FEEDS.worldSummary);
  return parseFeatureCollection(payload, Date.now());
}

/** Single-event lookup by USGS event id, for the cold-start deep-link case
 * (spec-v1.md §4.5: "handle direct deep-link cold start by fetching eventid
 * from fdsnws if not in cache"). Returns `null` if USGS has no such event
 * rather than throwing, so the caller can show a clean not-found state.
 *
 * IMPORTANT: unlike the region/world queries, `fdsnws/event/1/query` with an
 * `eventid` param returns a single bare GeoJSON `Feature` (`type:
 * "Feature"`), NOT a `FeatureCollection` — parsing it with
 * `usgsFeatureCollectionSchema`/`parseFeatureCollection` (as an earlier
 * version of this function did) throws on the very first `.parse()` call,
 * every time, for every real event; that throw happens outside any
 * try/catch and becomes an uncaught query error, so React Query retries a
 * couple of times and then permanently reports "not found" even though the
 * event was fetched successfully. Parse it as a single `Feature` instead. */
export async function fetchUsgsEventById(id: string): Promise<Event | null> {
  const params = new URLSearchParams({ format: "geojson", eventid: id });
  const url = `${USGS_FEEDS.fdsnEvent}?${params.toString()}`;

  try {
    const payload = await fetchJson(url);
    const parsed = usgsFeatureSchema.safeParse(payload);
    if (!parsed.success) {
      if (__DEV__) {
        console.warn(
          "[events/usgs] byId lookup response failed schema validation",
          parsed.error.issues[0],
        );
      }
      return null;
    }
    return normalizeUsgsFeature(parsed.data, Date.now());
  } catch (error) {
    if (__DEV__) {
      console.warn("[events/usgs] byId lookup failed", error);
    }
    return null;
  }
}
