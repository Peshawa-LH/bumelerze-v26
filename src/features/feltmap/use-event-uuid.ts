import { useQuery } from "@tanstack/react-query";

import type { Event } from "@/features/events";
import { lookUpEventUuidForEvent } from "@/features/shakemap/live-transport";

import { eventUuidQueryKey } from "./event-uuid-query";

/** How long an answer of "no id" counts as current before the registry is
 * asked again. A found id never changes and is kept for good. */
const NO_ID_RECHECK_MS = 15 * 60 * 1000;

/**
 * The registry uuid the felt-cells view is keyed by, with the lookup state.
 * The event page's route id is a provider or Bumelerze id; querying the view
 * with it answered 400 on every poll (2026-09-27). `uuid` is null until
 * resolved, when there is no registry to ask, or when the lookup failed.
 * Keyed by the event's provenance, which is its identity across feed
 * refreshes; the resolver itself caches for the session.
 *
 * A lookup that cannot reach the registry fails the query instead of
 * answering "no id": the query keeps an id it already had, nothing is saved
 * on the device, and the registry is asked again on the next visit, on
 * return to the app and when the connection comes back. Answered as "no
 * id", one attempt on a bad connection was kept for good and saved on the
 * device, turning the felt map and the Event hub off for days (2026-10-21).
 * "No id" is also asked again after `NO_ID_RECHECK_MS`, which clears such
 * an answer saved by an earlier version. A refresh or Retry asks again at
 * once while no id is known (`refetchEventUuidIfMissing`).
 */
export function useEventUuidResult(event: Event): {
  uuid: string | null;
  /** True while the first lookup is still in flight. */
  isPending: boolean;
} {
  const query = useQuery({
    queryKey: eventUuidQueryKey(event),
    queryFn: () => lookUpEventUuidForEvent(event),
    staleTime: (cached) =>
      typeof cached.state.data === "string" ? Infinity : NO_ID_RECHECK_MS,
    retry: 1,
  });
  return { uuid: query.data ?? null, isPending: query.isPending };
}

/** Null until resolved, when there is no registry to ask, or when the
 * lookup failed — the felt map stays idle in each case. */
export function useEventUuid(event: Event): string | null {
  return useEventUuidResult(event).uuid;
}
