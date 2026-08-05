import {
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

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`USGS request failed: ${response.status} ${url}`);
  }
  return response.json();
}

function buildRegionQueryUrl(): string {
  const startTime = new Date(
    Date.now() - REGION_FEED_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  const params = new URLSearchParams({
    format: "geojson",
    starttime: startTime,
    minlatitude: String(REGION_BBOX.minLat),
    maxlatitude: String(REGION_BBOX.maxLat),
    minlongitude: String(REGION_BBOX.minLon),
    maxlongitude: String(REGION_BBOX.maxLon),
    orderby: "time",
  });

  return `${USGS_FEEDS.fdsnQuery}?${params.toString()}`;
}

/** Region feed: fdsnws query, last 30 days, bbox from config.ts
 * (event-pipeline-design.md §4). */
export async function fetchUsgsRegionEvents(): Promise<UsgsFetchResult> {
  const payload = await fetchJson(buildRegionQueryUrl());
  return parseFeatureCollection(payload, Date.now());
}

/** World feed: the CDN-cached M4.5+/week summary feed — cheap, no bbox/time
 * filters needed (teardown-usgs-dyfi.md §2). */
export async function fetchUsgsWorldEvents(): Promise<UsgsFetchResult> {
  const payload = await fetchJson(USGS_FEEDS.worldSummary);
  return parseFeatureCollection(payload, Date.now());
}

/** Single-event lookup by USGS event id, for the cold-start deep-link case
 * (spec-v1.md §4.5: "handle direct deep-link cold start by fetching eventid
 * from fdsnws if not in cache"). Returns `null` if USGS has no such event
 * rather than throwing, so the caller can show a clean not-found state. */
export async function fetchUsgsEventById(id: string): Promise<Event | null> {
  const params = new URLSearchParams({ format: "geojson", eventid: id });
  const url = `${USGS_FEEDS.fdsnEvent}?${params.toString()}`;

  let payload: unknown;
  try {
    payload = await fetchJson(url);
  } catch {
    return null;
  }

  const result = parseFeatureCollection(payload, Date.now());
  return result.events[0] ?? null;
}
