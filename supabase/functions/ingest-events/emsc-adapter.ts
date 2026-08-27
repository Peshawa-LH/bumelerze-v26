// EMSC channel: fetch + zod-validate + normalize. Same split rationale as
// usgs-adapter.ts.

import { fetchJsonWithRetry } from "./http.ts";
import { normalizeEmscFeature, type EmscRawFeature } from "./normalize-emsc.ts";
import { emscFeatureCollectionSchema, emscFeatureSchema } from "./emsc-schema.ts";
import type { ChannelFetchResult } from "./types.ts";
import type { RegionBbox } from "./usgs-adapter.ts";

const EMSC_URL = "https://www.seismicportal.eu/fdsnws/event/1/query";
const TIMEOUT_MS = 10_000;

// EMSC documents the short param-name aliases (start/end, minlat/maxlat/
// minlon/maxlon), NOT the long USGS-style names — verified live, same
// distinction the client's own emsc.ts header comment makes.
export function buildEmscUrl(bbox: RegionBbox, sinceMs: number): string {
  const params = new URLSearchParams({
    format: "json",
    start: new Date(sinceMs).toISOString(),
    minlat: String(bbox.minLat),
    maxlat: String(bbox.maxLat),
    minlon: String(bbox.minLon),
    maxlon: String(bbox.maxLon),
    orderby: "time",
  });
  return `${EMSC_URL}?${params.toString()}`;
}

export async function fetchEmscChannel(
  bbox: RegionBbox,
  sinceMs: number,
): Promise<ChannelFetchResult> {
  const payload = await fetchJsonWithRetry(buildEmscUrl(bbox, sinceMs), {
    timeoutMs: TIMEOUT_MS,
  });
  const collection = emscFeatureCollectionSchema.parse(payload);

  const records: ChannelFetchResult["records"] = [];
  let skippedCount = 0;

  for (const rawFeature of collection.features) {
    const parsed = emscFeatureSchema.safeParse(rawFeature);
    if (!parsed.success) {
      skippedCount += 1;
      continue;
    }
    const record = normalizeEmscFeature(parsed.data as EmscRawFeature);
    if (!record) {
      skippedCount += 1;
      continue;
    }
    records.push(record);
  }

  return { channel: "emsc", records, skippedCount };
}
