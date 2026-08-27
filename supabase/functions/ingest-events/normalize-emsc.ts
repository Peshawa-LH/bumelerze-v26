// Pure EMSC-feature -> RawSourceRecord normalization. Zod-free (see
// normalize-usgs.ts's header comment for why).
//
// Verified live 2026-08-27 against
// https://www.seismicportal.eu/fdsnws/event/1/query: `properties.auth`
// really is present (`"auth": "EMSC"` on the sample fetched, matching
// source-and-ingestion-plan.md §5.1's "EMSC's `auth` field shows the real
// author is often not EMSC" — RSSC/NEIC/AFAD/IIEES/KOERI also appear there
// over time). The client's own `emsc-schema.ts` already lists `auth` in its
// zod shape (it just never carries it through `normalize.ts`'s `Event`) —
// this file is what finally reads it.

import type { RawSourceRecord } from "./types.ts";

export interface EmscRawFeature {
  id?: string;
  properties: {
    unid: string;
    /** ISO 8601, e.g. "2026-08-27T02:35:02.04Z". */
    time: string;
    lastupdate: string;
    lat: number;
    lon: number;
    depth: number;
    mag: number | null;
    magtype?: string | null;
    auth?: string | null;
    flynn_region?: string | null;
  };
}

export function normalizeEmscFeature(feature: EmscRawFeature): RawSourceRecord | null {
  const { properties } = feature;
  if (properties.mag === null) {
    return null;
  }

  const originTimeMs = Date.parse(properties.time);
  if (Number.isNaN(originTimeMs)) {
    return null;
  }
  const parsedUpdated = Date.parse(properties.lastupdate);
  const providerUpdatedAtMs = Number.isNaN(parsedUpdated) ? originTimeMs : parsedUpdated;

  const authorAgency = properties.auth ? properties.auth.toUpperCase() : null;

  return {
    provider: "emsc",
    providerEventId: properties.unid,
    rawPayload: feature as unknown as Record<string, unknown>,
    originTimeMs,
    lat: properties.lat,
    lon: properties.lon,
    depthKm: properties.depth,
    magnitude: properties.mag,
    magType: properties.magtype ?? null,
    place: properties.flynn_region ?? null,
    authorAgency,
    magnitudeAuthor: authorAgency,
    // EMSC's fdsnws response carries no review-lifecycle field analogous to
    // USGS's `status` — its feed is fundamentally a rapid/automatic system
    // (teardown-lastquake.md), so every EMSC-sourced record is conservatively
    // stamped 'automatic'. Revisit if EMSC ever documents a review flag.
    reviewStatus: "automatic",
    providerUpdatedAtMs,
  };
}
