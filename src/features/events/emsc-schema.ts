import { z } from "zod";

/**
 * Tolerant zod schema for an EMSC seismicportal.eu fdsnws GeoJSON feature
 * (teardown-lastquake.md §2: "EMSC exposes the same FDSN standard as USGS,"
 * `format=json` → GeoJSON FeatureCollection). EMSC's `properties` shape is
 * NOT the same as USGS's, even though both ride the FDSN WS-EVENT spec:
 * - EMSC repeats `lat`/`lon`/`depth` directly in `properties` (unlike USGS,
 *   which only carries them in `geometry.coordinates`) — this schema reads
 *   from `properties`, so `geometry` isn't required at all here.
 * - `time`/`lastupdate` are ISO 8601 strings, not epoch-ms numbers like
 *   USGS's `time`/`updated` — `normalize.ts` parses them.
 * - The provider's own event id is `unid` (USGS: `ids`/feature `id`).
 * - There is no `alert`/PAGER-equivalent field and no felt/`sig` field —
 *   EMSC events can never earn USGS's PAGER alert bonus in `computeClientSig`
 *   (see emsc.ts / normalize.ts for where that's made explicit).
 * As with usgs-schema.ts: fields we don't use aren't listed (zod strips
 * unknown keys by default), and a feature failing this schema is skipped,
 * not thrown — see `parseFeatureCollection` in emsc.ts.
 */
const emscPropertiesSchema = z.object({
  unid: z.string(),
  // ISO 8601 timestamps, e.g. "2023-02-06T01:17:34.0Z".
  time: z.string(),
  lastupdate: z.string(),
  lat: z.number(),
  lon: z.number(),
  depth: z.number(),
  mag: z.number().nullable(),
  magtype: z.string().nullable().optional(),
  evtype: z.string().nullable().optional(),
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

export type EmscFeature = z.infer<typeof emscFeatureSchema>;
