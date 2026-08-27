// Zod-at-the-IO-boundary gate for a parsed FDSN WS-EVENT text row, applied
// AFTER `normalize-fdsn-text.ts`'s `parseFdsnTextLine` has done the actual
// pipe-splitting + numeric coercion (that function already turns an
// unparseable numeric column or a missing required field into `null`,
// causing the row to be skipped upstream) — this is a second, defensive
// gate on the RESULT shape, same "manual coercion, then a zod pass"
// two-layer idiom the client's own `geofon.ts`/`geofon-schema.ts` pair
// already uses for the identical text format. Deno-only (`npm:` specifier).

import { z } from "npm:zod@3.25.76";

export const fdsnTextRowSchema = z.object({
  eventId: z.string().min(1),
  time: z.string().min(1),
  lat: z.number(),
  lon: z.number(),
  depthKm: z.number(),
  author: z.string().nullable(),
  contributor: z.string().nullable(),
  magType: z.string().nullable(),
  magnitude: z.number().nullable(),
  magAuthor: z.string().nullable(),
  locationName: z.string().nullable(),
});
