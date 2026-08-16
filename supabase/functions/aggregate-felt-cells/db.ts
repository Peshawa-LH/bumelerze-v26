// Supabase (service-role) data access for this function. Kept separate from
// `aggregate-event.ts`'s pure orchestration logic so the aggregation
// decision-making (grouping, dedup-via-vendored-aggregateCell, the
// idempotent skip-if-unchanged compare) can, in principle, be unit-tested
// without a live Postgres connection — this module is the only place that
// talks to the network.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.112.2";

import type { FeltCellInsertRow, FeltReportDetailRow, FeltReportRow } from "./types.ts";

/**
 * Creates the service-role Supabase client this function runs as.
 * `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided automatically
 * to every Supabase Edge Function's runtime environment (Deno.env) — never
 * committed to the repo, never read from anywhere else. The service-role
 * key has `BYPASSRLS` (supabase/README.md "service_role bypass is
 * implicit"), which is exactly what this function needs: it writes
 * `felt_cells` rows no anon/authenticated policy permits (0004_felt_cells.sql
 * has no client-facing insert/update policy on the base table by design).
 */
export function createServiceRoleClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceRoleKey) {
    throw new Error(
      "aggregate-felt-cells: missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY " +
        "in the function's environment — these are standard Supabase Edge " +
        "Function env vars, not something this repo sets; check the project's " +
        "function secrets, never hardcode them here.",
    );
  }
  return createClient(url, serviceRoleKey, { auth: { persistSession: false } });
}

/** All `felt_reports` rows associated with one event (`event_id is not
 * null` is the DB's own invariant for any row this query returns, since we
 * filter on it). Unassociated reports (`event_id is null`) are out of
 * scope for `felt_cells`, which is keyed on `event_id` — they simply don't
 * contribute until the (separate, not-this-wave) association job attaches
 * them to an event. */
export async function fetchReportsForEvent(
  client: SupabaseClient,
  eventId: string,
): Promise<FeltReportRow[]> {
  const { data, error } = await client
    .from("felt_reports")
    .select("report_id, device_id, event_id, cartoon_level, lat, lon, geohash_p5")
    .eq("event_id", eventId);
  if (error) {
    throw new Error(`fetchReportsForEvent(${eventId}): ${error.message}`);
  }
  return (data ?? []) as FeltReportRow[];
}

/** `felt_report_details` rows for a batch of `felt_report_id`s — the tier-2
 * upgrade, one-to-one with a subset of the reports `fetchReportsForEvent`
 * returned (migration 0003: `felt_report_id uuid not null unique`). A
 * report with no matching row here is tier-1-only. */
export async function fetchDetailsForReports(
  client: SupabaseClient,
  reportIds: readonly string[],
): Promise<FeltReportDetailRow[]> {
  if (reportIds.length === 0) {
    return [];
  }
  const { data, error } = await client
    .from("felt_report_details")
    .select(
      "felt_report_id, situation, felt_answer, others_felt_answer, motion_answer, " +
        "reaction_answer, stand_answer, shelf_answer, picture_answer, furniture_answer, " +
        "building_damage_level, damage_typology, road_damage_level",
    )
    .in("felt_report_id", reportIds as string[]);
  if (error) {
    throw new Error(`fetchDetailsForReports: ${error.message}`);
  }
  return (data ?? []) as FeltReportDetailRow[];
}

/** Distinct event ids that have at least one associated felt report whose
 * `submitted_at` falls within the lookback window — the sweep mode's
 * candidate list (`index.ts`'s "no `eventId` in the request body" branch).
 * Bounded by `sinceHours` specifically so a sweep stays cheap without a
 * dedicated "needs recompute" tracking table (PROJECT.md minimal-ops: no
 * extra infrastructure for something a time-bounded query already does
 * well enough at this app's report volume). */
export async function fetchEventIdsWithRecentReports(
  client: SupabaseClient,
  sinceHours: number,
): Promise<string[]> {
  const sinceIso = new Date(Date.now() - sinceHours * 60 * 60 * 1000).toISOString();
  const { data, error } = await client
    .from("felt_reports")
    .select("event_id")
    .not("event_id", "is", null)
    .gte("submitted_at", sinceIso);
  if (error) {
    throw new Error(`fetchEventIdsWithRecentReports: ${error.message}`);
  }
  const ids = new Set<string>();
  for (const row of (data ?? []) as { event_id: string | null }[]) {
    if (row.event_id) {
      ids.add(row.event_id);
    }
  }
  return Array.from(ids);
}

/** Every stored `felt_cells` row for an event, across all versions — used
 * both for the >=60s debounce check (latest `computed_at` per event) and
 * the idempotent skip-if-unchanged compare (latest row per geohash,
 * `aggregate-event.ts`'s `pickLatestPerGeohash`). Small enough to fetch in
 * one shot at this app's report volume (supabase/README.md's existing
 * "old versions retained" tradeoff already accepts this is not
 * indefinitely scalable — revisit if it ever becomes one). */
export async function fetchAllCellVersionsForEvent(
  client: SupabaseClient,
  eventId: string,
): Promise<(FeltCellInsertRow & { version: number; computed_at: string })[]> {
  const { data, error } = await client
    .from("felt_cells")
    .select(
      "event_id, geohash, precision, n_reports, n_tier2, cdi, cws, index_means, " +
        "damage_dist, ground_effects, version, computed_at",
    )
    .eq("event_id", eventId)
    .order("version", { ascending: false });
  if (error) {
    throw new Error(`fetchAllCellVersionsForEvent(${eventId}): ${error.message}`);
  }
  return (data ?? []) as unknown as (FeltCellInsertRow & {
    version: number;
    computed_at: string;
  })[];
}

/** Inserts one new `felt_cells` row (a new version — this table's rows are
 * append-only per its own migration comment, "old versions retained").
 * Never an UPDATE: the caller (`aggregate-event.ts`) only calls this when
 * the recomputed cell content actually differs from the latest stored
 * version, which is what makes repeat invocations with unchanged input a
 * true no-op rather than a version-number treadmill. */
export async function insertCellVersion(
  client: SupabaseClient,
  row: FeltCellInsertRow,
): Promise<void> {
  const { error } = await client.from("felt_cells").insert(row);
  if (error) {
    throw new Error(
      `insertCellVersion(${row.event_id}, ${row.geohash}, v${row.version}): ${error.message}`,
    );
  }
}
