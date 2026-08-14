import { z } from "zod";

/**
 * Zod schema for ONE parsed GEOFON fdsnws `format=text` row, applied AFTER
 * geofon.ts has pipe-split the line and coerced the numeric columns —
 * unlike usgs-schema.ts/emsc-schema.ts this isn't validating a JSON payload
 * shape (GEOFON has no `format=json`; verified live: 400), it is the
 * zod-at-the-IO-boundary gate for a hand-parsed text record. The column
 * order comes from the service's own header line:
 *
 *   #EventID|Time|Latitude|Longitude|Depth/km|Author|Catalog|Contributor|
 *    ContributorID|MagType|Magnitude|MagAuthor|EventLocationName|EventType
 *
 * This is the standard FDSN WS-EVENT text format (13 core columns) plus
 * GEOFON's appended `EventType` — the same format any SeisComP-based fdsnws
 * emits, which is why the parser in geofon.ts is deliberately reusable for
 * a future SeisComP source (provider-architecture.md).
 *
 * Columns we don't use (Author, Catalog, Contributor, ContributorID,
 * MagAuthor) are never lifted into this object at all. A row failing this
 * schema (empty id, unparseable number in a numeric column, missing
 * magnitude — GEOFON leaves the Magnitude column empty for not-yet-reviewed
 * events, the text-format analogue of USGS/EMSC's `mag: null`) is skipped
 * and counted, never thrown — same tolerant contract as the JSON providers.
 */
export const geofonRowSchema = z.object({
  eventId: z.string().min(1),
  /** ISO 8601 WITHOUT a zone designator (e.g. "2026-08-01T20:27:43.07") —
   * UTC per the FDSN text spec; normalize.ts appends the missing "Z" before
   * `Date.parse` (which would otherwise read a zone-less time as LOCAL). */
  time: z.string().min(1),
  latitude: z.number(),
  longitude: z.number(),
  depthKm: z.number(),
  /** May be empty ("") when the magnitude itself is present but untyped;
   * normalize.ts maps "" → "unknown", same as the other providers' null. */
  magType: z.string(),
  magnitude: z.number(),
  locationName: z.string(),
  /** GEOFON's 14th column ("earthquake", rarely "explosion" etc.). Optional:
   * a strict 13-column FDSN text source (another SeisComP deployment) still
   * parses. */
  eventType: z.string().optional(),
});

export type GeofonRow = z.infer<typeof geofonRowSchema>;
