// The run heartbeat (migration 0067, `public.feed_heartbeats`): one row per
// channel, upserted by `db.ts`'s `recordFeedHeartbeat` after every run. The
// watchdog `ops_check_feeds()` (pg_cron, every 15 minutes) opens an
// operations alert when a channel has had no successful run for its
// threshold (migration 0070: an hour for usgs, emsc and geofon, 49 hours for
// the daily isc run), pushes it to the admins and shows it on the admin
// home (review finding D-2: pg_cron only sees that the HTTP call was queued,
// so hours of 502s never showed anywhere). Pure, no imports, so the row shape
// is pinned under Jest against the migration's own column list
// (`__tests__/heartbeat.test.ts`) the way the felt transport pins its
// inserts against 0003.

import type { ChannelId, ChannelIngestSummary } from "./types.ts";

export type FeedHeartbeat =
  | { ok: true; summary: ChannelIngestSummary; emptyBody: boolean }
  | { ok: false; error: string };

/** `feed_heartbeats.last_error` is checked to 500 characters. */
export const HEARTBEAT_ERROR_MAX_LENGTH = 500;

export interface FeedHeartbeatRow {
  provider: ChannelId;
  last_ok_at?: string;
  last_summary?: {
    fetched: number;
    skippedParsing: number;
    created: number;
    updated: number;
    unchanged: number;
    errors: number;
    emptyBody: boolean;
  };
  last_error_at?: string;
  last_error?: string;
  updated_at: string;
}

/**
 * The upsert row for one run. A successful run sets `last_ok_at` and the
 * counts; a failed one sets `last_error_at`/`last_error` and leaves
 * `last_ok_at` untouched (an upsert only writes the columns it names), so
 * the watchdog's clock keeps running from the last real success.
 */
export function buildFeedHeartbeatRow(
  provider: ChannelId,
  heartbeat: FeedHeartbeat,
  nowIso: string,
): FeedHeartbeatRow {
  if (heartbeat.ok) {
    return {
      provider,
      last_ok_at: nowIso,
      last_summary: {
        fetched: heartbeat.summary.fetched,
        skippedParsing: heartbeat.summary.skippedParsing,
        created: heartbeat.summary.created,
        updated: heartbeat.summary.updated,
        unchanged: heartbeat.summary.unchanged,
        errors: heartbeat.summary.errors,
        emptyBody: heartbeat.emptyBody,
      },
      updated_at: nowIso,
    };
  }
  return {
    provider,
    last_error_at: nowIso,
    last_error: heartbeat.error.slice(0, HEARTBEAT_ERROR_MAX_LENGTH),
    updated_at: nowIso,
  };
}
