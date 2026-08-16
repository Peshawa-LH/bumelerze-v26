import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { getSupabaseClient, isSupabaseConfigured } from "@/lib/supabase";
import {
  POSSIBLE_EVENTS_REFETCH_INTERVAL_MS,
  POSSIBLE_EVENTS_WINDOW_HOURS,
} from "./config";

/**
 * Crowd-detected "possible event" (D26 item 3, felt-detection-design.md §3)
 * — a `public.events` row with `status = 'possible'`
 * (supabase/migrations/0012_crowd_detection.sql's `detect_possible_events`).
 * Deliberately NOT folded into the `Event` model (`./types.ts`): a possible
 * event has no magnitude (crowd detection can't estimate one), no place
 * string (the client renders an area from coordinates via the gazetteer,
 * same as `Event`'s own `placeLine` does), and no provenance/URL — forcing
 * it into `Event`'s shape would mean every `Event` consumer in the app
 * (EventCard, ShakeMapSection, the felt-report registration snapshot, ...)
 * would need new null-handling for fields that are supposed to always be
 * present on a real catalog event.
 */
export interface PossibleEvent {
  /** `events.event_id` (uuid) — the canonical server id, already resolved;
   * unlike `Event.id`, there is no provider-id/uuid distinction here since
   * this row IS the canonical event from the moment it's created. */
  id: string;
  /** Median report client-timestamp, UTC ms (server: percentile_cont(0.5)
   * over the triggering cluster's created_at values). */
  originTime: number;
  lat: number;
  lon: number;
  /** When the possible event was created server-side, UTC ms — used for
   * "how long has this been unconfirmed" bookkeeping, not shown as a
   * headline number this wave. */
  createdAt: number;
}

/** Column list, in the query's own select order — mirrors
 * `features/feltmap/types.ts`'s FELT_CELL_ROW_COLUMNS convention (single
 * source of truth for both the zod schema and the transport's `.select()`
 * call). */
export const POSSIBLE_EVENT_ROW_COLUMNS = [
  "event_id",
  "origin_time",
  "lat",
  "lon",
  "created_at",
] as const;

const possibleEventRowSchema = z.object({
  event_id: z.string().min(1),
  origin_time: z.string(),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  created_at: z.string(),
});

export interface ParsedPossibleEventRows {
  events: PossibleEvent[];
  /** Same tolerant-parsing bookkeeping convention as
   * `feltmap/types.ts`/`events/usgs.ts`: one malformed row is dropped and
   * counted, never a reason to fail the whole read (typescript-react-
   * native.md "no silent catches" is about swallowed errors, not about
   * discarding one bad row from an otherwise-good response). */
  skippedCount: number;
}

/** Tolerant array parse + row->domain mapping, in one pass (this module's
 * only consumer). */
export function parsePossibleEventRows(data: unknown): ParsedPossibleEventRows {
  if (!Array.isArray(data)) {
    return { events: [], skippedCount: 0 };
  }

  const events: PossibleEvent[] = [];
  let skippedCount = 0;

  for (const item of data) {
    const result = possibleEventRowSchema.safeParse(item);
    if (!result.success) {
      skippedCount += 1;
      continue;
    }
    const row = result.data;
    events.push({
      id: row.event_id,
      originTime: Date.parse(row.origin_time),
      lat: row.lat,
      lon: row.lon,
      createdAt: Date.parse(row.created_at),
    });
  }

  return { events, skippedCount };
}

/**
 * Transport seam (same shape/spirit as `features/feltmap/transport.ts`'s
 * `FeltMapTransport`) so `usePossibleEvents` never talks to
 * `@supabase/supabase-js` directly — tests inject a fixture-backed
 * `PossibleEventsTransport` instead of mocking the query-builder chain.
 */
export interface PossibleEventsTransport {
  fetchPossibleEvents(): Promise<PossibleEvent[]>;
}

/**
 * The real transport. Reads `public.events` directly (not a view — unlike
 * `felt_cells_public`, there's no aggregation/threshold logic to hide
 * behind one; `events_public_select`'s existing `using (true)` RLS policy
 * already covers every status value, `status = 'possible'` included, so no
 * migration-side RLS change was needed for this read — see
 * 0012_crowd_detection.sql's own header comment).
 */
export const SupabasePossibleEventsTransport: PossibleEventsTransport = {
  async fetchPossibleEvents(): Promise<PossibleEvent[]> {
    const client = getSupabaseClient();
    if (!client) {
      // Defensive only — `usePossibleEvents` gates the query itself on
      // `isSupabaseConfigured()`, matching `SupabaseFeltMapTransport`'s own
      // "nothing was attempted" fallback for a state the caller already
      // guarded against.
      return [];
    }

    const cutoff = new Date(
      Date.now() - POSSIBLE_EVENTS_WINDOW_HOURS * 60 * 60 * 1000,
    ).toISOString();

    const { data, error } = await client
      .from("events")
      .select(POSSIBLE_EVENT_ROW_COLUMNS.join(", "))
      .eq("status", "possible")
      .gte("created_at", cutoff)
      .order("created_at", { ascending: false });

    if (error) {
      // No silent catches (repo rule) — rethrown so React Query's `isError`
      // path is reachable, even though `usePossibleEvents` currently folds
      // it into the same "nothing to show" state as "no possible events" —
      // see that function's own doc comment for why.
      throw error;
    }

    return parsePossibleEventRows(data ?? []).events;
  },
};

export const possibleEventsQueryKeys = {
  all: ["events", "possible"] as const,
};

export interface UsePossibleEventsResult {
  events: PossibleEvent[];
  /** False whenever no Supabase project is configured yet — same
   * `isSupabaseConfigured()` env-gating every other Supabase-backed read in
   * this app follows (`lib/supabase.ts`). */
  isReady: boolean;
}

/**
 * Home's possible-events hook (D26 item 3). Unlike `useFeltMap`, this
 * deliberately does NOT surface a distinct "offline" state: a possible-event
 * card is a supplementary, non-critical surface (nothing in the app depends
 * on it being visible), so a transient fetch failure just means "no card
 * this refresh" rather than an error banner competing for attention with
 * the main feed's own offline handling — same "no empty-state noise"
 * philosophy `useFeltMap`'s doc comment already applies to its `hidden`
 * state, taken one step further here since there's no "known to exist but
 * temporarily unreachable" data to be honest about (unlike a specific
 * event's felt map).
 */
export function usePossibleEvents(
  transport: PossibleEventsTransport = SupabasePossibleEventsTransport,
): UsePossibleEventsResult {
  const configured = isSupabaseConfigured();

  const query = useQuery({
    queryKey: possibleEventsQueryKeys.all,
    queryFn: () => transport.fetchPossibleEvents(),
    enabled: configured,
    staleTime: POSSIBLE_EVENTS_REFETCH_INTERVAL_MS / 2,
    refetchInterval: POSSIBLE_EVENTS_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });

  if (!configured) {
    return { events: [], isReady: false };
  }

  return { events: query.data ?? [], isReady: true };
}
