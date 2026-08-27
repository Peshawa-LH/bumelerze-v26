// Zod-at-the-IO-boundary schema for an EMSC seismicportal.eu fdsnws
// GeoJSON feature. This function's own copy of
// `src/features/events/emsc-schema.ts` (that one also lists `auth`, just
// never reads it downstream) — Deno-only, see usgs-schema.ts's header
// comment for why validation lives here, not in the Jest-tested
// `normalize-emsc.ts`.

import { z } from "npm:zod@3.25.76";

const emscPropertiesSchema = z.object({
  unid: z.string(),
  time: z.string(),
  lastupdate: z.string(),
  lat: z.number(),
  lon: z.number(),
  depth: z.number(),
  mag: z.number().nullable(),
  magtype: z.string().nullable().optional(),
  auth: z.string().nullable().optional(),
  flynn_region: z.string().nullable().optional(),
});

export const emscFeatureSchema = z.object({
  type: z.literal("Feature"),
  id: z.string().optional(),
  properties: emscPropertiesSchema,
});

export const emscFeatureCollectionSchema = z.object({
  type: z.literal("FeatureCollection"),
  features: z.array(z.unknown()),
});
