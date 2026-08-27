// USGS channel: fetch + zod-validate + normalize. Deno-only (imports both
// `npm:zod` transitively via usgs-schema.ts and this module's own network
// call) — the validation (`usgsFeatureSchema`) and I/O (`fetchJsonWithRetry`)
// live here specifically so `normalize-usgs.ts` stays a plain, zero-
// dependency, Jest-testable function (see that file's own header comment
// and provider-architecture.md's "same shape as the client's own
// <provider>.ts / <provider>-schema.ts / normalize<Provider>X split").

import { fetchJsonWithRetry } from "./http.ts";
import { normalizeUsgsFeature, type UsgsRawFeature } from "./normalize-usgs.ts";
import { usgsFeatureCollectionSchema, usgsFeatureSchema } from "./usgs-schema.ts";
import type { ChannelFetchResult } from "./types.ts";

const USGS_URL = "https://earthquake.usgs.gov/fdsnws/event/1/query";
const TIMEOUT_MS = 10_000;

export interface RegionBbox {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

export function buildUsgsUrl(bbox: RegionBbox, sinceMs: number): string {
  const params = new URLSearchParams({
    format: "geojson",
    starttime: new Date(sinceMs).toISOString(),
    minlatitude: String(bbox.minLat),
    maxlatitude: String(bbox.maxLat),
    minlongitude: String(bbox.minLon),
    maxlongitude: String(bbox.maxLon),
    orderby: "time",
  });
  return `${USGS_URL}?${params.toString()}`;
}

export async function fetchUsgsChannel(
  bbox: RegionBbox,
  sinceMs: number,
): Promise<ChannelFetchResult> {
  const payload = await fetchJsonWithRetry(buildUsgsUrl(bbox, sinceMs), {
    timeoutMs: TIMEOUT_MS,
  });
  const collection = usgsFeatureCollectionSchema.parse(payload);

  const records: ChannelFetchResult["records"] = [];
  let skippedCount = 0;

  for (const rawFeature of collection.features) {
    const parsed = usgsFeatureSchema.safeParse(rawFeature);
    if (!parsed.success) {
      skippedCount += 1;
      continue;
    }
    const record = normalizeUsgsFeature(parsed.data as UsgsRawFeature);
    if (!record) {
      skippedCount += 1;
      continue;
    }
    records.push(record);
  }

  return { channel: "usgs", records, skippedCount };
}
