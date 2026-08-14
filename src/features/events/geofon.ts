import { GEOFON_FEEDS, REGION_BBOX, REGION_FEED_WINDOW_DAYS } from "./config";
import { geofonRowSchema } from "./geofon-schema";
import { normalizeGeofonRow } from "./normalize";
import type { Event } from "./types";

export interface GeofonFetchResult {
  events: Event[];
  /** Count of data lines present in the response but skipped (wrong column
   * count, failed schema validation, unusable magnitude/time) — same
   * tolerant-parsing contract as `UsgsFetchResult.skippedCount`. */
  skippedCount: number;
  fetchedAt: number;
}

/** The 13 core FDSN WS-EVENT text columns; GEOFON appends `EventType` as a
 * 14th. Rows with FEWER than 13 pipe-separated fields are malformed and
 * skipped; extra trailing columns from other SeisComP deployments are
 * tolerated (read by index, surplus ignored). */
const FDSN_TEXT_MIN_FIELDS = 13;

/** "" / non-numeric → undefined (which then fails `geofonRowSchema`'s
 * `z.number()` and skips the row — or, for optional columns, is simply
 * absent). `Number("")` is 0, hence the explicit empty check. */
function toFiniteNumber(field: string): number | undefined {
  const trimmed = field.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : undefined;
}

/**
 * Parses a raw GEOFON fdsnws `format=text` payload into normalized events,
 * tolerantly. Deliberately a dumb line-by-line pipe-split — no regex over
 * row content:
 *
 * - Lines starting with `#` are header/comment lines (the service emits one
 *   `#EventID|Time|...` header; any future comment line is equally
 *   ignorable). Blank lines (including the trailing newline's empty tail,
 *   and an entirely EMPTY body — the FDSN `nodata=204` no-events response)
 *   are not data and not errors.
 * - Each remaining line is pipe-split and read BY INDEX per the documented
 *   header order (geofon-schema.ts). A line with fewer than the 13 core
 *   FDSN columns, or whose id/time/numeric columns fail the zod schema, is
 *   skipped and counted — one bad row never takes down the poll.
 *
 * Unlike the JSON providers there is no top-level shape to reject: any text
 * body degrades to "0 events, N skipped" at worst, and the HTTP layer
 * (`fetchText`) already threw on a non-OK status.
 */
export function parseGeofonText(text: string, fetchedAt: number): GeofonFetchResult {
  const events: Event[] = [];
  let skippedCount = 0;

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }

    const fields = line.split("|");
    if (fields.length < FDSN_TEXT_MIN_FIELDS) {
      skippedCount += 1;
      if (__DEV__) {
        console.warn(
          `[events/geofon] skipped a row with ${fields.length} fields (expected >= ${FDSN_TEXT_MIN_FIELDS})`,
        );
      }
      continue;
    }

    // The length guard above proves indices 0–12 exist; the `?? ""`
    // fallbacks are only for noUncheckedIndexedAccess's benefit.
    const parsed = geofonRowSchema.safeParse({
      eventId: (fields[0] ?? "").trim(),
      time: (fields[1] ?? "").trim(),
      latitude: toFiniteNumber(fields[2] ?? ""),
      longitude: toFiniteNumber(fields[3] ?? ""),
      depthKm: toFiniteNumber(fields[4] ?? ""),
      // Columns 5–8 (Author/Catalog/Contributor/ContributorID) unused.
      magType: (fields[9] ?? "").trim(),
      magnitude: toFiniteNumber(fields[10] ?? ""),
      // Column 11 (MagAuthor) unused.
      locationName: (fields[12] ?? "").trim(),
      eventType: fields[13]?.trim(),
    });
    if (!parsed.success) {
      skippedCount += 1;
      if (__DEV__) {
        console.warn(
          "[events/geofon] skipped a row that failed schema validation",
          parsed.error.issues[0],
        );
      }
      continue;
    }

    const event = normalizeGeofonRow(parsed.data, fetchedAt);
    if (!event) {
      skippedCount += 1;
      continue;
    }

    events.push(event);
  }

  return { events, skippedCount, fetchedAt };
}

async function fetchText(url: string, signal?: AbortSignal): Promise<string> {
  const response = await fetch(url, signal ? { signal } : {});
  if (!response.ok) {
    throw new Error(`GEOFON request failed: ${response.status} ${url}`);
  }
  return response.text();
}

/**
 * GEOFON's fdsnws takes the SAME short bbox aliases as EMSC's
 * (minlat/maxlat/minlon/maxlon) with the long-form `starttime` — verified
 * live against geofon.gfz.de, not assumed from the spec. `format=text`
 * because GEOFON serves no `format=json` at all (400 on it).
 */
function buildRegionQueryUrl(): string {
  const startTime = new Date(
    Date.now() - REGION_FEED_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  const params = new URLSearchParams({
    format: "text",
    starttime: startTime,
    minlat: String(REGION_BBOX.minLat),
    maxlat: String(REGION_BBOX.maxLat),
    minlon: String(REGION_BBOX.minLon),
    maxlon: String(REGION_BBOX.maxLon),
    orderby: "time",
  });

  return `${GEOFON_FEEDS.fdsnQuery}?${params.toString()}`;
}

/**
 * Region feed, GEOFON leg of the parallel completeness merge (merge.ts;
 * queries.ts is the only caller). Same bbox and time window as the USGS and
 * EMSC legs, so all three legs always describe the same region and period.
 *
 * `signal` lets the caller apply this leg's own abort budget
 * (config.GEOFON_REGION_TIMEOUT_MS) — timeout policy lives in queries.ts.
 */
export async function fetchGeofonRegionEvents(
  signal?: AbortSignal,
): Promise<GeofonFetchResult> {
  const text = await fetchText(buildRegionQueryUrl(), signal);
  return parseGeofonText(text, Date.now());
}
