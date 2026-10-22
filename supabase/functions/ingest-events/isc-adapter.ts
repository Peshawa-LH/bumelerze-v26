// ISC channel: the daily backfill/correction bulletin sweep
// (the ingestion plan §5 channel 4). Verified live 2026-08-27
// against `http://www.isc.ac.uk/fdsnws/event/1/query` — NOTE the literal
// `http://` (not https): that is what ISC's own service serves and what the
// design doc's own worked example (§3) queries; not a typo.
//
// Long-form param names (minlatitude/maxlatitude/minlongitude/
// maxlongitude/starttime/endtime), matching the design doc's own verified
// example query — NOT the short aliases GEOFON/EMSC use. No `contributor=`
// filter: the ingestion plan §5 wants everything ISC carries in
// the region (ISN, SLUB, ISK, TEH, THR, AFAD, IDC), not one agency.
//
// `format=text` — same FDSN WS-EVENT text layout as GEOFON (verified live:
// identical column header), so this channel reuses `fdsn-text-adapter.ts`
// unchanged, exactly as the provider-architecture notes §3 anticipated for "a
// second FDSN-text-speaking source". Every row from this channel is
// stamped `review_status = 'reviewed'` — the ISC bulletin's whole nature is
// a reviewed catalog (the ingestion plan §1), not a per-row flag.

import { fetchFdsnTextChannel } from "./fdsn-text-adapter.ts";
import type { ChannelFetchResult } from "./types.ts";
import type { RegionBbox } from "./usgs-adapter.ts";

const ISC_URL = "http://www.isc.ac.uk/fdsnws/event/1/query";
const TIMEOUT_MS = 20_000; // ISC is a bulletin query over a wide window; generous budget.

/**
 * `YYYY-MM-DDThh:mm:ss`, UTC (FDSN times carry no zone; UTC by spec). ISC
 * refuses the `Z` that `toISOString()` appends: since 2026-09-27 every daily
 * run got "Error 400: Bad Request: The value ...Z for starttime is invalid"
 * as a 200 text page (19 lines, all skipped), so the channel fetched nothing
 * while its heartbeat said ok (verified live 2026-10-22; without the `Z` the
 * same query returns the bulletin, 496 rows over 450 days).
 */
export function fdsnUtcTime(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19);
}

export function buildIscUrl(bbox: RegionBbox, sinceMs: number): string {
  const params = new URLSearchParams({
    format: "text",
    starttime: fdsnUtcTime(sinceMs),
    minlatitude: String(bbox.minLat),
    maxlatitude: String(bbox.maxLat),
    minlongitude: String(bbox.minLon),
    maxlongitude: String(bbox.maxLon),
  });
  return `${ISC_URL}?${params.toString()}`;
}

export function fetchIscChannel(bbox: RegionBbox, sinceMs: number): Promise<ChannelFetchResult> {
  return fetchFdsnTextChannel({
    channel: "isc",
    provider: "isc",
    url: buildIscUrl(bbox, sinceMs),
    timeoutMs: TIMEOUT_MS,
    defaultReviewStatus: "reviewed",
  });
}
