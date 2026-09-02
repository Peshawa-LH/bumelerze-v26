import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { z } from "zod";

import { getSupabaseClient, isSupabaseConfigured } from "@/lib/supabase";
import type { Event, EventProvider } from "./types";

/**
 * Bumelerze event identity (owner directive 2026-09-02: "we sometimes use
 * the USGS ids and the USGS-assigned name for events; we have to fix this.
 * We can use USGS data like magnitude or stations but cannot replicate
 * their id or event names"). This module is the READ-ONLY transport that
 * turns an already-normalized feed `Event`'s (provider, providerId) into
 * its canonical `bml` id, when Supabase already knows one
 * (`events.bumelerze_id`, migration 0008/0025/0026) — it never allocates
 * one itself (that stays the server's job, `upsert_event_from_client` /
 * `allocate_bumelerze_id`).
 */

/** Canonical Bumelerze id shape: `bml` + 4-digit UTC origin year +
 * lowercase base-36 per-year counter, zero-padded to at least 4 characters
 * and growing past `zzzz` (migration 0025's `format_bumelerze_id`, ported
 * app-side for tests in `supabase/migrations/bumelerze-id-reference.ts`).
 * This module only needs to RECOGNIZE the shape (to tell a route param
 * apart from a provider id) — allocation/formatting stays exclusively
 * server-side. */
const BUMELERZE_ID_RE = /^bml\d{4}[0-9a-z]{4,}$/;

export function isBumelerzeId(id: string): boolean {
  return BUMELERZE_ID_RE.test(id);
}

/**
 * Session-lifetime cache of `(provider, providerId) -> bumelerze_id | null`
 * — same shape/spirit as `features/felt/supabase-transport.ts`'s own
 * `eventUuidCache` (see that module's doc comment): every lookup for the
 * SAME provider sighting within one app session reuses the first result
 * rather than round-tripping again. A `null` entry is cached too (not just
 * a hit) — "this event isn't registered in Supabase yet" is itself a
 * stable answer for the rest of the session, not a reason to keep asking.
 */
const bumelerzeIdCache = new Map<string, string | null>();

function cacheKey(provider: EventProvider, providerId: string): string {
  return `${provider}:${providerId}`;
}

const sourceRecordEventIdRowSchema = z.object({ event_id: z.string().min(1) });
const eventBumelerzeIdRowSchema = z.object({
  bumelerze_id: z.string().min(1).nullable(),
});

/**
 * Resolves an already-normalized `Event`'s (provider, providerId) to its
 * canonical `bumelerze_id`, entirely READ-only — unlike
 * `upsert_event_from_client` (migration 0011), this never registers a new
 * event and never allocates an id; it only reads what the server already
 * assigned. Two small anon-readable selects, same two-step join
 * `source-corroboration.ts`'s transport already uses for the identical
 * (provider, providerId) -> internal event_id resolution:
 *  1. `event_source_records` (migration 0023 `event_source_records_public_select`)
 *     — (provider, provider_event_id) -> event_id.
 *  2. `events` (migration 0002 `events_public_select`) — event_id -> bumelerze_id.
 * Fails soft to `null` for every not-yet-known case (no Supabase project
 * configured, this event was never registered server-side yet — most feed
 * events, most of the time — or a network/DB error) — never throws. An
 * unresolved bml id means the UI keeps showing the provider id, and only
 * ever in the Source section, never as the headline (`types.ts`'s own doc
 * comment on `Event.bumelerzeId`).
 */
export async function resolveBumelerzeId(event: Event): Promise<string | null> {
  const { provider, providerId } = event.provenance;
  const key = cacheKey(provider, providerId);
  if (bumelerzeIdCache.has(key)) {
    return bumelerzeIdCache.get(key) ?? null;
  }

  const client = getSupabaseClient();
  if (!client) {
    // Defensive only — callers gate on `isSupabaseConfigured()` themselves;
    // not cached, so a later call (once configured) can still resolve.
    return null;
  }

  try {
    const { data: sourceRow, error: sourceError } = await client
      .from("event_source_records")
      .select("event_id")
      .eq("provider", provider)
      .eq("provider_event_id", providerId)
      .maybeSingle();

    if (sourceError) {
      return null;
    }
    const parsedSource = sourceRecordEventIdRowSchema.safeParse(sourceRow);
    if (!parsedSource.success) {
      // No registry row yet for this provider sighting — a stable "not yet
      // known" answer, worth caching.
      bumelerzeIdCache.set(key, null);
      return null;
    }

    const { data: eventRow, error: eventError } = await client
      .from("events")
      .select("bumelerze_id")
      .eq("event_id", parsedSource.data.event_id)
      .maybeSingle();

    if (eventError) {
      return null;
    }
    const parsedEvent = eventBumelerzeIdRowSchema.safeParse(eventRow);
    const bumelerzeId = parsedEvent.success ? parsedEvent.data.bumelerze_id : null;
    bumelerzeIdCache.set(key, bumelerzeId);
    return bumelerzeId;
  } catch {
    // Network exception from the client itself (as opposed to a typed
    // PostgREST error response) — same "degrade to unresolved, never
    // throw" contract as `resolveEventUuid`'s own catch block.
    return null;
  }
}

export function bumelerzeIdQueryKey(
  provider: EventProvider,
  providerId: string,
): readonly [string, string, EventProvider, string] {
  return ["events", "bumelerzeId", provider, providerId] as const;
}

export interface UseBumelerzeIdResult {
  bumelerzeId: string | null;
}

/**
 * React Query wrapper around `resolveBumelerzeId` — cached in the app's
 * shared `QueryClient` (`createEventsQueryClient`, `queries.ts`) on top of
 * `resolveBumelerzeId`'s own session-lifetime `Map`, so a screen that
 * already resolved this event's bml id once this session never re-fetches
 * it, and a cold app restart at least has React Query's own persisted
 * cache to fall back on (`createEventsPersister`) before hitting the
 * network again. `staleTime: Infinity` — once assigned, a bml id is
 * immutable forever (migration 0025's own allocation guarantee: "never
 * reused"), so there is nothing to ever refetch for a KNOWN id; an
 * unresolved (`null`) result still gets React Query's ordinary staleness
 * handling via `enabled` re-runs on remount, since the event may simply not
 * have been registered server-side YET.
 */
export function useBumelerzeId(
  event: Event | null,
  enabled: boolean,
): UseBumelerzeIdResult {
  const configured = isSupabaseConfigured();
  const provider = event?.provenance.provider;
  const providerId = event?.provenance.providerId;

  const query: UseQueryResult<string | null> = useQuery({
    queryKey:
      provider && providerId
        ? bumelerzeIdQueryKey(provider, providerId)
        : (["events", "bumelerzeId", "none"] as const),
    queryFn: () => resolveBumelerzeId(event as Event),
    enabled: configured && enabled && Boolean(event),
    staleTime: Infinity,
  });

  return { bumelerzeId: query.data ?? null };
}
