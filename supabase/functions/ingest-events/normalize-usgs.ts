// Pure USGS-feature -> RawSourceRecord normalization. Deliberately zod-free
// (see usgs-adapter.ts's header comment) so this file can be `require`d
// directly by Jest despite the rest of this function running on Deno.
//
// Verified live 2026-08-27 against
// https://earthquake.usgs.gov/fdsnws/event/1/query (region bbox, 2024-01-01
// onward): a real feature carries `net: "us"`, `sources: ",us,"`,
// `status: "reviewed"|"automatic"` — none of which the client's own
// `usgs-schema.ts`/`normalize.ts` capture (that pair only needs `mag`,
// `place`, `time`, `updated`, `magType`, `alert`, `url`, `sig`, `ids`). This
// is the ONLY place USGS field names may appear in this function, mirroring
// the client-side convention (PROJECT.md gotcha) even though this is a
// separate, richer normalizer for a separate purpose.

import type { RawSourceRecord } from "./types.ts";

/** The subset of a USGS GeoJSON feature this ingester reads. Structurally
 * identical to `usgs-schema.ts`'s zod-inferred type but declared
 * independently (no import from that Deno-only file) so this module has
 * zero runtime dependency on `npm:zod`. */
export interface UsgsRawFeature {
  id: string;
  properties: {
    mag: number | null;
    place?: string | null;
    time: number;
    updated: number;
    magType?: string | null;
    /** Network code that contributed the preferred origin, e.g. "us", "ak" —
     * USGS's own attribution field. Uppercased into `authorAgency`/
     * `magnitudeAuthor` below ("us" -> "US", aliased to NEIC by
     * `derivation.ts`'s `locationAuthorityRank`). */
    net?: string | null;
    /** "automatic" | "reviewed" (USGS's own lifecycle status field) — maps
     * directly onto `event_source_records.review_status`'s allow-list. Any
     * other/missing value is treated as "automatic" (the conservative
     * default — see `usgs-adapter.ts` for why "deleted" is never inferred
     * from a live feed response). */
    status?: string | null;
  };
  geometry: {
    /** [lon, lat, depthKm] — USGS's own coordinate order. */
    coordinates: [number, number, number];
  };
}

/**
 * Returns `null` for a structurally-valid-but-unusable feature (USGS emits
 * `mag: null` for events pending review) — counted and skipped by the
 * caller, never thrown, same tolerant contract as every other provider
 * adapter in this codebase.
 */
export function normalizeUsgsFeature(feature: UsgsRawFeature): RawSourceRecord | null {
  const { properties, geometry, id } = feature;
  if (properties.mag === null) {
    return null;
  }

  const [lon, lat, depthKm] = geometry.coordinates;
  const authorAgency = properties.net ? properties.net.toUpperCase() : null;
  const reviewStatus: "automatic" | "reviewed" =
    properties.status === "reviewed" ? "reviewed" : "automatic";

  return {
    provider: "usgs",
    providerEventId: id,
    rawPayload: feature as unknown as Record<string, unknown>,
    originTimeMs: properties.time,
    lat,
    lon,
    depthKm,
    magnitude: properties.mag,
    magType: properties.magType ?? null,
    place: properties.place ?? null,
    // USGS exposes one attribution field for the whole preferred solution —
    // same value serves both location and magnitude authorship (unlike the
    // FDSN-text providers, which can genuinely differ; see
    // normalize-fdsn-text.ts).
    authorAgency,
    magnitudeAuthor: authorAgency,
    reviewStatus,
    providerUpdatedAtMs: properties.updated,
  };
}
