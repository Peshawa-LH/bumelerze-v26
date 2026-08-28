import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { getSupabaseClient, isSupabaseConfigured } from "@/lib/supabase";
import type { Event } from "./types";

/**
 * Supplementary corroboration query (owner brief 2026-08-28: "the tag for
 * source ... we should keep for the sources especially"). The feed itself
 * keeps fetching straight from the agencies (`queries.ts`'s
 * `fetchRegionEventsMerged` etc.) — that direct path is the deliberate
 * offline fallback and this module must never touch it. This is a SEPARATE,
 * best-effort read against the server-side ingester's registry
 * (`public.event_source_records` / `public.events_with_sources`,
 * supabase/migrations/0023) that fills in "who else saw this" for events
 * already on screen, degrading silently to nothing when Supabase is
 * unreachable or an event isn't in the registry yet — `TagRow` already
 * knows how to fall back to the single provider chip when that happens.
 *
 * **Join key** (confirmed against 0002/0023): `event_source_records` is
 * uniquely keyed on `(provider, provider_event_id)` — exactly
 * `event.provenance.provider` / `event.provenance.providerId` on the app's
 * own `Event` model. Two steps, both batched per provider group rather than
 * per card:
 *  1. `event_source_records` → resolve each on-screen (provider,
 *     providerId) pair to the internal `event_id` uuid the ingester merged
 *     it into.
 *  2. `events_with_sources` → the full corroborating-agency list for those
 *     internal ids.
 * A single combined query isn't possible from the client: the app doesn't
 * know the internal `event_id` until step 1 resolves it, and PostgREST has
 * no arbitrary self-join. Both steps are `.in()` batches (chunked, see
 * `CORROBORATION_BATCH_SIZE`), never one request per card.
 */

/** PostgREST/Postgres has no hard `.in()` size limit worth relying on, but a
 * feed screen can legitimately hold a couple hundred rows (World Catalog) —
 * chunking keeps each request's URL a sane size and keeps one slow chunk
 * from blocking the others (`Promise.all`). */
const CORROBORATION_BATCH_SIZE = 40;

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

const sourceRecordLookupRowSchema = z.object({
  event_id: z.string().min(1),
  provider: z.string().min(1),
  provider_event_id: z.string().min(1),
});

const eventSourceEntrySchema = z.object({
  provider: z.string().min(1),
  authorAgency: z.string().min(1).nullable(),
});

const eventWithSourcesRowSchema = z.object({
  event_id: z.string().min(1),
  sources: z.array(eventSourceEntrySchema),
});

/** One event's corroboration, keyed by the app's own `Event.id` (not the
 * internal registry uuid — that's a lookup detail this module hides). */
export interface SourceCorroboration {
  /** Distinct authoring agencies, first-seen order (registry insertion
   * order — `events_with_sources`' own `jsonb_agg(... order by fetched_at
   * asc)`), already deduplicated by `dedupeAgencies` below. Falls back to
   * the upper-cased provider tag for a source with no named author, same
   * rule as the view's own `corroboration_count` (migration 0023). */
  agencies: string[];
}

function dedupeAgencies(
  sources: readonly z.infer<typeof eventSourceEntrySchema>[],
): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const source of sources) {
    const agency = source.authorAgency ?? source.provider.toUpperCase();
    if (!seen.has(agency)) {
      seen.add(agency);
      ordered.push(agency);
    }
  }
  return ordered;
}

/**
 * Transport seam (same shape/spirit as `feltmap/transport.ts`'s
 * `FeltMapTransport`) so the hook never talks to `@supabase/supabase-js`
 * directly — tests inject a fixture-backed transport instead of mocking the
 * query-builder chain.
 */
export interface SourceCorroborationTransport {
  fetchCorroboration(
    events: readonly Event[],
  ): Promise<Map<string, SourceCorroboration>>;
}

/**
 * The real transport. Both requests are read-only, anonymous-accessible
 * (0023 grants `select` on both surfaces to `anon`) — no auth session
 * needed, matching every other Supabase read in this app.
 */
export const SupabaseSourceCorroborationTransport: SourceCorroborationTransport =
  {
    async fetchCorroboration(
      events: readonly Event[],
    ): Promise<Map<string, SourceCorroboration>> {
      const client = getSupabaseClient();
      if (!client || events.length === 0) {
        // Defensive only — `useEventSourceAgencies` gates the query itself
        // on `isSupabaseConfigured()` and an empty event list.
        return new Map();
      }

      // Step 1: (provider, providerId) -> internal event_id, one .in()
      // batch per provider (usually 1-3 requests total, never one per
      // card) — the provider allow-list is small and fixed
      // (EventProvider), so grouping by it keeps every request a plain
      // single-column `.in()` rather than needing an `.or()` of ANDed
      // tuples.
      const byProvider = new Map<string, Event[]>();
      for (const event of events) {
        const list = byProvider.get(event.provenance.provider) ?? [];
        list.push(event);
        byProvider.set(event.provenance.provider, list);
      }

      const lookupRequests: Promise<{ event: Event; internalId: string }[]>[] =
        [];
      for (const [provider, providerEvents] of byProvider) {
        for (const batch of chunk(providerEvents, CORROBORATION_BATCH_SIZE)) {
          lookupRequests.push(
            (async () => {
              const { data, error } = await client
                .from("event_source_records")
                .select("event_id, provider, provider_event_id")
                .eq("provider", provider)
                .in(
                  "provider_event_id",
                  batch.map((event) => event.provenance.providerId),
                );

              if (error) {
                // No silent catches (repo rule) — rethrown so React
                // Query's `isError` path is reachable; the HOOK is what
                // decides to degrade quietly (matches
                // `possible.ts`/`usePossibleEvents`'s own documented
                // precedent for a supplementary, non-critical surface).
                throw error;
              }

              const rows = (data ?? [])
                .map((row) => sourceRecordLookupRowSchema.safeParse(row))
                .filter((result) => result.success)
                .map((result) => result.data);

              const byProviderEventId = new Map(
                rows.map((row) => [row.provider_event_id, row.event_id]),
              );

              return batch.flatMap((event) => {
                const internalId = byProviderEventId.get(
                  event.provenance.providerId,
                );
                return internalId ? [{ event, internalId }] : [];
              });
            })(),
          );
        }
      }

      const resolved = (await Promise.all(lookupRequests)).flat();
      if (resolved.length === 0) {
        return new Map();
      }

      // Step 2: internal event_id -> corroborating sources, again chunked.
      const internalIds = Array.from(
        new Set(resolved.map(({ internalId }) => internalId)),
      );

      const sourcesByInternalId = new Map<string, SourceCorroboration>();
      await Promise.all(
        chunk(internalIds, CORROBORATION_BATCH_SIZE).map(async (batch) => {
          const { data, error } = await client
            .from("events_with_sources")
            .select("event_id, sources")
            .in("event_id", batch);

          if (error) {
            throw error;
          }

          for (const row of data ?? []) {
            const result = eventWithSourcesRowSchema.safeParse(row);
            if (!result.success) {
              continue;
            }
            sourcesByInternalId.set(result.data.event_id, {
              agencies: dedupeAgencies(result.data.sources),
            });
          }
        }),
      );

      const byAppEventId = new Map<string, SourceCorroboration>();
      for (const { event, internalId } of resolved) {
        const corroboration = sourcesByInternalId.get(internalId);
        if (corroboration) {
          byAppEventId.set(event.id, corroboration);
        }
      }
      return byAppEventId;
    },
  };

const EMPTY_CORROBORATION_MAP: ReadonlyMap<string, SourceCorroboration> =
  new Map();

/**
 * Batched hook for a screen's worth of on-screen events — call it once per
 * list (or once with a single-element array for the map preview sheet /
 * event-detail header), never per card. Deliberately does NOT surface an
 * offline/error state of its own: a missing entry just means "no
 * corroboration data yet" and `TagRow` already renders the ordinary
 * single-provider fallback for that case, so a Supabase outage never blocks
 * or degrades the primary feed render (owner brief: "never blocking the
 * feed's render") — same "supplementary surface, quiet failure" precedent
 * as `usePossibleEvents`.
 */
export function useEventSourceAgencies(
  events: readonly Event[],
  transport: SourceCorroborationTransport = SupabaseSourceCorroborationTransport,
): ReadonlyMap<string, SourceCorroboration> {
  const configured = isSupabaseConfigured() && events.length > 0;

  // Stable, order-independent key: two renders with the same set of
  // (provider, providerId) pairs must hit the same cache entry even if the
  // feed re-sorted, so a re-render from an unrelated state change doesn't
  // re-fetch. Sorted once per render, not memoized — this list is at most a
  // couple hundred short strings, cheap next to the network round trip it
  // guards.
  const idsKey = [...events]
    .map((event) => `${event.provenance.provider}:${event.provenance.providerId}`)
    .sort();

  const query = useQuery({
    queryKey: ["events", "sourceCorroboration", idsKey],
    queryFn: () => transport.fetchCorroboration(events),
    enabled: configured,
    staleTime: 60_000,
  });

  return query.data ?? EMPTY_CORROBORATION_MAP;
}
