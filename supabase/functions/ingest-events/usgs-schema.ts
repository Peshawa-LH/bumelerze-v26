// Zod-at-the-IO-boundary schema for a USGS GeoJSON feature, this function's
// own copy (richer than the client's `src/features/events/usgs-schema.ts`:
// this one also validates `net`/`status`, which `normalize-usgs.ts` reads
// and the client-side pair never needed). Deno-only (`npm:` specifier) —
// see `usgs-adapter.ts`'s header comment for why validation lives here and
// not in the Jest-tested `normalize-usgs.ts`.

import { z } from "npm:zod@3.25.76";

const usgsPropertiesSchema = z.object({
  mag: z.number().nullable(),
  place: z.string().nullable().optional(),
  time: z.number(),
  updated: z.number(),
  magType: z.string().nullable().optional(),
  net: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
});

const usgsGeometrySchema = z.object({
  type: z.literal("Point"),
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
