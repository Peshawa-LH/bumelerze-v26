// The channel registry — source-and-ingestion-plan.md §5: "Six channels...
// Every channel is a row in one registry, so adding one is a config change
// and an adapter, never an app release."
//
// DESIGN CHOICE: a plain TypeScript config module (this file), not a
// database table. Considered and rejected: a `channels` DB table would let
// cadence/enabled-ness change without a redeploy, but (a) every other
// engineering-owned tunable in this codebase already lives in a
// well-commented code constant, migration-reviewed and git-blamed, never a
// dashboard-editable row (`src/features/events/config.ts`'s REGION_BBOX/
// DEDUP_*, migration 0011/0012's own inlined thresholds) — a channels table
// would be the one exception, not a consistency win; (b) adding a channel
// ALWAYS requires a new adapter file regardless of where cadence config
// lives, so a DB row saves no real engineering effort, only moves one
// constant out of git history and out of code review; (c) this table would
// need its own RLS decision for zero client benefit (no client ever reads
// it). Cadence changes AND new channels both go through this file + one
// `cron.schedule(...)` call in a migration — exactly "a row [here] plus an
// adapter", just both live in git, not in Postgres.
//
// REGION_BBOX mirrors `src/features/events/config.ts` REGION_BBOX exactly
// (same literal values already duplicated into SQL by migrations 0011/0012
// with a "keep in sync" comment) — a fourth documented copy, not a new
// pattern.

import { fetchEmscChannel } from "./emsc-adapter.ts";
import { fetchGeofonChannel } from "./geofon-adapter.ts";
import { fetchIscChannel } from "./isc-adapter.ts";
import { fetchUsgsChannel } from "./usgs-adapter.ts";
import type { ChannelCadence, ChannelFetchResult, ChannelId } from "./types.ts";
import type { RegionBbox } from "./usgs-adapter.ts";

export const REGION_BBOX: RegionBbox = {
  minLat: 33.0,
  maxLat: 38.5,
  minLon: 41.0,
  maxLon: 48.5,
};

/**
 * How far back each channel looks on every tick. Deliberately NOT the
 * client's 180-day `REGION_FEED_WINDOW_DAYS` (that constant serves a
 * different job: client-side cache-widening for the sparse/dense Home-feed
 * policy). This ingester's lookback only needs to be wide enough to catch a
 * revision to a RECENT event — a magnitude getting reviewed, an origin
 * getting relocated — not to re-derive months of unchanged history on every
 * tick. `sourceRecordChanged` (matching.ts) makes an over-wide window cheap
 * anyway (an unchanged record is a no-op, never a duplicate write), so
 * these are chosen for "generous enough to not miss a real revision",
 * not "as narrow as possible".
 */
const LIVE_CHANNEL_LOOKBACK_HOURS = 72; // EMSC/USGS/GEOFON: 3 days.

/**
 * ISC is "authoritative backfill and correction... a reviewed bulletin,
 * not a feed" (source-and-ingestion-plan.md §5) running roughly 13 months
 * behind (§1) — this channel's whole JOB is re-checking a wide historical
 * window daily for agency corrections/promotions our earlier live-channel
 * ingest couldn't have seen yet. 450 days covers the observed ~13-month lag
 * with a two-month margin.
 *
 * KNOWN COST (see this function's own README "Growth" section for the
 * measured numbers): re-fetching a ~450-day window daily means this
 * channel re-examines largely the SAME rows every single run;
 * `sourceRecordChanged` keeps that cheap in terms of DB WRITES (unchanged
 * rows are skipped), but the fetch itself still downloads the full window
 * from ISC every day. TODO once real volume is measured: track a
 * per-channel "last successful sweep endtime" cursor (a one-row state
 * table, or simply `max(fetched_at)` already on `event_source_records`)
 * and only widen the ISC window backward on a slower cadence (e.g. weekly)
 * while polling a narrow recent slice daily — not built now (this wave's
 * brief: measure and recommend, don't solve).
 */
const ISC_LOOKBACK_DAYS = 450;

export interface ChannelDefinition {
  id: ChannelId;
  provider: ChannelId;
  cadence: ChannelCadence;
  /** Human-readable, for structured logging only. */
  label: string;
  fetch: (nowMs: number) => Promise<ChannelFetchResult>;
}

export const CHANNELS: Record<ChannelId, ChannelDefinition> = {
  emsc: {
    id: "emsc",
    provider: "emsc",
    cadence: { kind: "live", intervalSeconds: 60 },
    label: "EMSC (seismicportal.eu)",
    fetch: (nowMs) =>
      fetchEmscChannel(REGION_BBOX, nowMs - LIVE_CHANNEL_LOOKBACK_HOURS * 60 * 60 * 1000),
  },
  usgs: {
    id: "usgs",
    provider: "usgs",
    cadence: { kind: "live", intervalSeconds: 60 },
    label: "USGS / NEIC",
    fetch: (nowMs) =>
      fetchUsgsChannel(REGION_BBOX, nowMs - LIVE_CHANNEL_LOOKBACK_HOURS * 60 * 60 * 1000),
  },
  geofon: {
    id: "geofon",
    provider: "geofon",
    cadence: { kind: "live", intervalSeconds: 300 },
    label: "GEOFON / GFZ",
    fetch: (nowMs) =>
      fetchGeofonChannel(REGION_BBOX, nowMs - LIVE_CHANNEL_LOOKBACK_HOURS * 60 * 60 * 1000),
  },
  isc: {
    id: "isc",
    provider: "isc",
    cadence: { kind: "bulletin", times: "daily" },
    label: "ISC bulletin (backfill/correction sweep)",
    fetch: (nowMs) => fetchIscChannel(REGION_BBOX, nowMs - ISC_LOOKBACK_DAYS * 24 * 60 * 60 * 1000),
  },
};

export function isChannelId(value: string): value is ChannelId {
  return value in CHANNELS;
}
