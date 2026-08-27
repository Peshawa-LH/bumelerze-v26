// Shared FDSN WS-EVENT text-format parser + normalizer for the two
// pipe-delimited channels: GEOFON (`geofon-adapter.ts`) and ISC
// (`isc-adapter.ts`). Both channels speak the SAME 13/14-column format
// (`format=text`) — this is the `fdsn-text.ts` extraction
// provider-architecture.md §3 anticipated "the moment a second real FDSN
// text source arrives" ("Factor the shared text parser out into
// fdsn-text.ts... not before"): ISC is that second source. Zod-free, same
// reason as normalize-usgs.ts.
//
// Column layout, verified live 2026-08-27 against BOTH
// https://geofon.gfz.de/fdsnws/event/1/query and
// http://www.isc.ac.uk/fdsnws/event/1/query (`format=text`):
//
//   #EventID|Time|Latitude|Longitude|Depth/km|Author|Catalog|Contributor|
//    ContributorID|MagType|Magnitude|MagAuthor|EventLocationName|EventType
//
// The two live responses differ in exactly the way
// source-and-ingestion-plan.md predicts:
// - GEOFON leaves `Author`/`MagAuthor` BLANK for its own automatic
//   solutions and puts the real attribution in `Contributor` (`"GFZ"`).
// - ISC's bulletin rows carry a real `Author` (who located it) AND can
//   carry a DIFFERENT `MagAuthor` (who magnitude-reviewed it) — e.g. the
//   live row `643726562|...|AFAD|AFAD|AFAD|638696784|ML|2.10|ISK|...`:
//   Author=AFAD, MagAuthor=ISK. This is the concrete evidence behind
//   `event_source_records.magnitude_author` being its own column
//   (migration 0023) rather than reusing `author_agency` for both.
//
// Fallback chain (this module's own rule, not FDSN spec): location author
// = Author, or Contributor when Author is blank (GEOFON's case). Magnitude
// author = MagAuthor, or the resolved location author when MagAuthor is
// blank (the common case: same agency did both).

import type { RawSourceRecord } from "./types.ts";

/** Standard FDSN WS-EVENT text core column count; GEOFON/ISC both append
 * EventType as a 14th. Mirrors `FDSN_TEXT_MIN_FIELDS` in the client's own
 * `geofon.ts`. */
export const FDSN_TEXT_MIN_FIELDS = 13;

export interface FdsnTextRow {
  eventId: string;
  time: string;
  lat: number;
  lon: number;
  depthKm: number;
  author: string | null;
  contributor: string | null;
  magType: string | null;
  magnitude: number | null;
  magAuthor: string | null;
  locationName: string | null;
}

function emptyToNull(field: string | undefined): string | null {
  const trimmed = (field ?? "").trim();
  return trimmed.length === 0 ? null : trimmed;
}

function toFiniteNumberOrNull(field: string | undefined): number | null {
  const trimmed = (field ?? "").trim();
  if (trimmed.length === 0) {
    return null;
  }
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

/**
 * Parses one pipe-delimited data line (already trimmed, already known not
 * to be blank or a `#`-comment line — see `<provider>-adapter.ts`'s
 * line-splitting loop) into a `FdsnTextRow`, or `null` when the line is
 * malformed: fewer than the 13 core columns, or a required numeric/id
 * column fails to parse. Same tolerant-skip contract as every other
 * adapter — a caller counts a `null` return as one skipped row.
 */
export function parseFdsnTextLine(line: string): FdsnTextRow | null {
  const fields = line.split("|");
  if (fields.length < FDSN_TEXT_MIN_FIELDS) {
    return null;
  }

  const eventId = emptyToNull(fields[0]);
  const time = emptyToNull(fields[1]);
  const lat = toFiniteNumberOrNull(fields[2]);
  const lon = toFiniteNumberOrNull(fields[3]);
  const depthKm = toFiniteNumberOrNull(fields[4]);
  if (eventId === null || time === null || lat === null || lon === null || depthKm === null) {
    return null;
  }

  return {
    eventId,
    time,
    lat,
    lon,
    depthKm,
    author: emptyToNull(fields[5]),
    contributor: emptyToNull(fields[7]),
    magType: emptyToNull(fields[9]),
    magnitude: toFiniteNumberOrNull(fields[10]),
    magAuthor: emptyToNull(fields[11]),
    locationName: emptyToNull(fields[12]),
  };
}

/** Same zone-designator handling as the client's `normalizeGeofonRow`
 * (`parseFdsnTextTimeUtc`): FDSN text times carry no zone designator and are
 * UTC by spec, but `Date.parse` reads a zone-less ISO string as LOCAL time —
 * append "Z" only when no designator is already present. */
const ISO_ZONE_DESIGNATOR_RE = /(?:Z|[+-]\d{2}:?\d{2})$/i;

export function parseFdsnTextTimeUtc(value: string): number {
  const withZone = ISO_ZONE_DESIGNATOR_RE.test(value) ? value : `${value}Z`;
  return Date.parse(withZone);
}

export interface NormalizeFdsnTextOptions {
  provider: "geofon" | "isc";
  /** Applied to every row this channel produces — ISC's bulletin is
   * reviewed by nature (source-and-ingestion-plan.md §1: "ISC is a reviewed
   * bulletin, not a feed"); GEOFON's automatic near-real-time solutions are
   * not. Neither format exposes a per-row review flag, so this is a
   * channel-level default, not read from the row. */
  defaultReviewStatus: "automatic" | "reviewed";
}

/**
 * Row -> `RawSourceRecord`. Returns `null` when the row has no usable
 * magnitude (GEOFON leaves `Magnitude` blank for not-yet-reviewed events,
 * same convention as USGS/EMSC's `mag: null`) or an unparseable time —
 * counted and skipped by the caller.
 */
export function normalizeFdsnTextRow(
  row: FdsnTextRow,
  options: NormalizeFdsnTextOptions,
): RawSourceRecord | null {
  if (row.magnitude === null) {
    return null;
  }
  const originTimeMs = parseFdsnTextTimeUtc(row.time);
  if (Number.isNaN(originTimeMs)) {
    return null;
  }

  const locationAuthor = row.author ?? row.contributor;
  const magnitudeAuthor = row.magAuthor ?? locationAuthor;

  return {
    provider: options.provider,
    providerEventId: row.eventId,
    rawPayload: { ...row } as unknown as Record<string, unknown>,
    originTimeMs,
    lat: row.lat,
    lon: row.lon,
    depthKm: row.depthKm,
    magnitude: row.magnitude,
    magType: row.magType,
    place: row.locationName,
    authorAgency: locationAuthor ? locationAuthor.toUpperCase() : null,
    magnitudeAuthor: magnitudeAuthor ? magnitudeAuthor.toUpperCase() : null,
    reviewStatus: options.defaultReviewStatus,
    // Neither format carries a revision timestamp — same fallback the
    // client's own normalizeGeofonRow uses.
    providerUpdatedAtMs: originTimeMs,
  };
}

/**
 * Splits a full `format=text` response body into normalized records,
 * tolerantly. Lines starting with `#` are header/comment lines (both
 * services emit a `#EventID|...` header; ISC additionally appends a
 * trailing `# Agencies whose data contributed...` block, verified live —
 * also `#`-prefixed, so it is skipped by the exact same rule with no
 * special-casing needed). Blank lines (including the FDSN `nodata=204`
 * empty-body case) are not data and not errors.
 */
export function parseFdsnTextBody(
  text: string,
  options: NormalizeFdsnTextOptions,
): { records: RawSourceRecord[]; skippedCount: number } {
  const records: RawSourceRecord[] = [];
  let skippedCount = 0;

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }
    const row = parseFdsnTextLine(line);
    if (row === null) {
      skippedCount += 1;
      continue;
    }
    const record = normalizeFdsnTextRow(row, options);
    if (record === null) {
      skippedCount += 1;
      continue;
    }
    records.push(record);
  }

  return { records, skippedCount };
}
