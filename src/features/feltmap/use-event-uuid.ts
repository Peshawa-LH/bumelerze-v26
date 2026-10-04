import { useQuery } from "@tanstack/react-query";

import type { Event } from "@/features/events";
import { resolveEventUuidForEvent } from "@/features/shakemap";

/**
 * The registry uuid the felt-cells view is keyed by, with the lookup state.
 * The event page's route id is a provider or Bumelerze id; querying the view
 * with it answered 400 on every poll (2026-09-27). `uuid` is null until
 * resolved, or when there is no registry to ask. Keyed by the event's
 * provenance, which is its identity across feed refreshes; the resolver
 * itself caches for the session.
 */
export function useEventUuidResult(event: Event): {
  uuid: string | null;
  /** True while the first lookup is still in flight. */
  isPending: boolean;
} {
  const query = useQuery({
    queryKey: [
      "event-uuid",
      event.provenance.provider,
      event.provenance.providerId,
    ] as const,
    queryFn: () => resolveEventUuidForEvent(event),
    staleTime: Infinity,
    retry: 1,
  });
  return { uuid: query.data ?? null, isPending: query.isPending };
}

/** Null until resolved, or when there is no registry to ask — the felt map
 * stays idle either way. */
export function useEventUuid(event: Event): string | null {
  return useEventUuidResult(event).uuid;
}
