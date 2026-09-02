import { useQuery } from "@tanstack/react-query";

import { getSupabaseClient, isSupabaseConfigured } from "@/lib/supabase";

import { normalizeSupabaseEventRow } from "./normalize";
import {
  eventsWithSourcesRowSchema,
  primarySourceRowSchema,
} from "./supabase-event-schema";
import type { Event } from "./types";

export type { EventsWithSourcesRow, PrimarySourceRow } from "./supabase-event-schema";
// Re-exported here too (its "real" home is `normalize.ts`, alongside every
// other provider's normalizer — see that module's own doc comment) so
// every OTHER Supabase-row concern (the fetch, the hook, the row schemas)
// keeps living in this one file, mirroring `usgs.ts`'s own "fetch module
// re-exports nothing, calls into normalize.ts" split, just with the schema
// held in its own file since (unlike USGS/EMSC/GEOFON) two different row
// shapes feed one normalizer here.
export { normalizeSupabaseEventRow };

/**
 * Fetches an event by its canonical bml id straight from Supabase (the
 * `/event/[id]` cold-start fallback for a bml id no cached feed knows —
 * `app/event/[id].tsx`'s own routing doc comment). Two selects, same shape
 * as `resolveBumelerzeId`'s own two-step join, just walked in the other
 * direction:
 *  1. `events_with_sources` (migration 0023) by `bumelerze_id` — every
 *     canonical field this screen needs, in one row.
 *  2. `event_source_records` (migration 0023) by `event_id`, earliest
 *     `fetched_at` first — the ORIGINAL provider sighting, for
 *     provenance/citation (same "first-seen" ordering
 *     `events_with_sources`' own `sources` jsonb_agg uses).
 * Returns `null` for every not-found/not-configured/network-failure case —
 * never throws (same fail-soft contract as `fetchUsgsEventById`).
 */
export async function fetchSupabaseEventByBumelerzeId(
  bumelerzeId: string,
): Promise<Event | null> {
  const client = getSupabaseClient();
  if (!client) {
    return null;
  }

  try {
    const { data: eventRow, error: eventError } = await client
      .from("events_with_sources")
      .select(
        "event_id, bumelerze_id, origin_time, lat, lon, depth_km, magnitude, mag_type, place, updated_at",
      )
      .eq("bumelerze_id", bumelerzeId)
      .maybeSingle();

    if (eventError) {
      return null;
    }
    const parsedEvent = eventsWithSourcesRowSchema.safeParse(eventRow);
    if (!parsedEvent.success) {
      return null;
    }

    const { data: sourceRow, error: sourceError } = await client
      .from("event_source_records")
      .select("provider, provider_event_id, fetched_at")
      .eq("event_id", parsedEvent.data.event_id)
      .order("fetched_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    const parsedSource = sourceError
      ? null
      : (() => {
          const result = primarySourceRowSchema.safeParse(sourceRow);
          return result.success ? result.data : null;
        })();

    return normalizeSupabaseEventRow(parsedEvent.data, parsedSource);
  } catch {
    return null;
  }
}

export function supabaseEventByBumelerzeIdQueryKey(
  bumelerzeId: string,
): readonly [string, string, string] {
  return ["events", "byBumelerzeId", bumelerzeId] as const;
}

export interface UseEventByBumelerzeIdResult {
  event: Event | null;
  isLoading: boolean;
  isError: boolean;
}

/**
 * `/event/[id]` cold-start bml-id lookup — only fires when `enabled` is
 * true (the caller has already checked every cached feed/alias and come up
 * empty), mirroring `queries.ts`'s own `useEventById`'s "enabled guarantees
 * we actually need this network request" convention.
 */
export function useEventByBumelerzeId(
  bumelerzeId: string | undefined,
  enabled: boolean,
): UseEventByBumelerzeIdResult {
  const configured = isSupabaseConfigured();

  const query = useQuery({
    queryKey: supabaseEventByBumelerzeIdQueryKey(bumelerzeId ?? ""),
    queryFn: () => fetchSupabaseEventByBumelerzeId(bumelerzeId as string),
    enabled: configured && enabled && Boolean(bumelerzeId),
  });

  return {
    event: query.data ?? null,
    isLoading: query.isPending && enabled && configured,
    isError: query.isError,
  };
}
