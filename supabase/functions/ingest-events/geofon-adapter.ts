// GEOFON channel: URL + cadence-specific defaults, using the shared
// fdsn-text-adapter.ts machinery. GEOFON serves NO `format=json` (verified
// live: 400, same as the client's own geofon.ts finding) — `format=text`
// with the short bbox aliases (minlat/maxlat/minlon/maxlon), same as EMSC's.

import { fetchFdsnTextChannel } from "./fdsn-text-adapter.ts";
import type { ChannelFetchResult } from "./types.ts";
import type { RegionBbox } from "./usgs-adapter.ts";

const GEOFON_URL = "https://geofon.gfz.de/fdsnws/event/1/query";
const TIMEOUT_MS = 10_000;

export function buildGeofonUrl(bbox: RegionBbox, sinceMs: number): string {
  const params = new URLSearchParams({
    format: "text",
    starttime: new Date(sinceMs).toISOString(),
    minlat: String(bbox.minLat),
    maxlat: String(bbox.maxLat),
    minlon: String(bbox.minLon),
    maxlon: String(bbox.maxLon),
    orderby: "time",
  });
  return `${GEOFON_URL}?${params.toString()}`;
}

export function fetchGeofonChannel(bbox: RegionBbox, sinceMs: number): Promise<ChannelFetchResult> {
  return fetchFdsnTextChannel({
    channel: "geofon",
    provider: "geofon",
    url: buildGeofonUrl(bbox, sinceMs),
    timeoutMs: TIMEOUT_MS,
    // GEOFON's own automatic near-real-time solutions — see
    // normalize-fdsn-text.ts's NormalizeFdsnTextOptions doc comment.
    defaultReviewStatus: "automatic",
  });
}
