// ISC channel: the daily backfill/correction bulletin sweep
// (source-and-ingestion-plan.md §5 channel 4). Verified live 2026-08-27
// against `http://www.isc.ac.uk/fdsnws/event/1/query` — NOTE the literal
// `http://` (not https): that is what ISC's own service serves and what the
// design doc's own worked example (§3) queries; not a typo.
//
// Long-form param names (minlatitude/maxlatitude/minlongitude/
// maxlongitude/starttime/endtime), matching the design doc's own verified
// example query — NOT the short aliases GEOFON/EMSC use. No `contributor=`
// filter: source-and-ingestion-plan.md §5 wants everything ISC carries in
// the region (ISN, SLUB, ISK, TEH, THR, AFAD, IDC), not one agency.
//
// `format=text` — same FDSN WS-EVENT text layout as GEOFON (verified live:
// identical column header), so this channel reuses `fdsn-text-adapter.ts`
// unchanged, exactly as provider-architecture.md §3 anticipated for "a
// second FDSN-text-speaking source". Every row from this channel is
// stamped `review_status = 'reviewed'` — the ISC bulletin's whole nature is
// a reviewed catalog (source-and-ingestion-plan.md §1), not a per-row flag.

import { fetchFdsnTextChannel } from "./fdsn-text-adapter.ts";
import type { ChannelFetchResult } from "./types.ts";
import type { RegionBbox } from "./usgs-adapter.ts";

const ISC_URL = "http://www.isc.ac.uk/fdsnws/event/1/query";
const TIMEOUT_MS = 20_000; // ISC is a bulletin query over a wide window; generous budget.

export function buildIscUrl(bbox: RegionBbox, sinceMs: number): string {
  const params = new URLSearchParams({
    format: "text",
    starttime: new Date(sinceMs).toISOString(),
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
