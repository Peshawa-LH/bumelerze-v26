import { z } from "zod";

/**
 * Tolerant zod schema for a USGS earthquake GeoJSON feature
 * (teardown-usgs-dyfi.md §2 — same shape for the fdsnws `format=geojson`
 * query and the CDN summary feeds). Deliberately permissive:
 * - Fields we don't use are simply not listed — zod objects strip unknown
 *   keys by default, so USGS adding a new property never breaks parsing.
 * - Fields USGS itself sometimes emits as `null` (`mag`, `place`, `magType`,
 *   `alert`) are typed nullable/optional here; `normalize.ts` decides what
 *   to do with a null value (usually: skip the feature, counted).
 * A feature that fails this schema is skipped, not thrown — see
 * `parseFeatureCollection` in usgs.ts for the per-feature tolerant loop.
 */
const usgsPropertiesSchema = z.object({
  mag: z.number().nullable(),
  place: z.string().nullable().optional(),
  time: z.number(),
  updated: z.number(),
  url: z.string().optional(),
  alert: z.string().nullable().optional(),
  sig: z.number().optional(),
  ids: z.string().optional(),
  magType: z.string().nullable().optional(),
  type: z.string().optional(),
});

const usgsGeometrySchema = z.object({
  type: z.literal("Point"),
  // [lon, lat, depthKm]. Required as a full triple — a feature missing
  // depth is rare/malformed and is skipped upstream rather than guessed at.
  coordinates: z.tuple([z.number(), z.number(), z.number()]),
});

export const usgsFeatureSchema = z.object({
  type: z.literal("Feature"),
  id: z.string(),
  properties: usgsPropertiesSchema,
  geometry: usgsGeometrySchema,
});

export const usgsFeatureCollectionSchema = z.object({
  type: z.literal("FeatureCollection"),
  features: z.array(z.unknown()),
});

export type UsgsFeature = z.infer<typeof usgsFeatureSchema>;
