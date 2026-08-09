import { EMSC_FEEDS, REGION_BBOX, REGION_FEED_WINDOW_DAYS } from "./config";
import { normalizeEmscFeature } from "./normalize";
import {
  emscFeatureCollectionSchema,
  emscFeatureSchema,
} from "./emsc-schema";
import type { Event } from "./types";

export interface EmscFetchResult {
  events: Event[];
  /** Count of features present in the response but skipped (failed schema
   * validation, unusable magnitude/time) — same tolerant-parsing contract
   * as `UsgsFetchResult.skippedCount` (usgs.ts). */
  skippedCount: number;
  fetchedAt: number;
}

/** Parses a raw EMSC GeoJSON FeatureCollection payload into normalized
 * events, tolerantly — mirrors `parseFeatureCollection` in usgs.ts. A
 * malformed top-level payload still throws (nothing tolerant to do with a
 * response that isn't GeoJSON at all); the caller turns that into a failed
 * fetch, which is exactly the failure queries.ts already handles. */
function parseFeatureCollection(
  payload: unknown,
  fetchedAt: number,
): EmscFetchResult {
  const collection = emscFeatureCollectionSchema.parse(payload);

  const events: Event[] = [];
  let skippedCount = 0;

  for (const rawFeature of collection.features) {
    const parsed = emscFeatureSchema.safeParse(rawFeature);
    if (!parsed.success) {
      skippedCount += 1;
      if (__DEV__) {
        console.warn(
          "[events/emsc] skipped a feature that failed schema validation",
          parsed.error.issues[0],
        );
      }
      continue;
    }

    const event = normalizeEmscFeature(parsed.data, fetchedAt);
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
    throw new Error(`EMSC request failed: ${response.status} ${url}`);
  }
  return response.json();
}

/**
 * EMSC's fdsnws query documents its filters using the short param-name
 * aliases — `start`/`end`, `minlat`/`maxlat`/`minlon`/`maxlon` — rather than
 * the `starttime`/`minlatitude`-style long names the USGS query in usgs.ts
 * uses (teardown-lastquake.md §2's exact filter list). Same FDSN WS-EVENT
 * spec, different documented alias; kept literal to what was verified
 * against the primary source rather than assumed-interchangeable.
 */
function buildRegionQueryUrl(): string {
  const startTime = new Date(
    Date.now() - REGION_FEED_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  const params = new URLSearchParams({
    format: "json",
    start: startTime,
    minlat: String(REGION_BBOX.minLat),
    maxlat: String(REGION_BBOX.maxLat),
    minlon: String(REGION_BBOX.minLon),
    maxlon: String(REGION_BBOX.maxLon),
    orderby: "time",
  });

  return `${EMSC_FEEDS.fdsnQuery}?${params.toString()}`;
}

/**
 * Region feed, EMSC fallback path only (D4 second tier; failover, not a
 * general-purpose EMSC feed — queries.ts is the only caller). Same bbox and
 * time window as `fetchUsgsRegionEvents`, so switching providers mid-session
 * never changes what "region" means to the user.
 *
 * `signal` lets the caller apply the same abort budget it used for the USGS
 * attempt (or none, for a direct/manual EMSC call) — this function itself
 * has no opinion about timeouts, that policy lives in queries.ts.
 */
export async function fetchEmscRegionEvents(
  signal?: AbortSignal,
): Promise<EmscFetchResult> {
  const payload = await fetchJson(buildRegionQueryUrl(), signal);
  return parseFeatureCollection(payload, Date.now());
}
