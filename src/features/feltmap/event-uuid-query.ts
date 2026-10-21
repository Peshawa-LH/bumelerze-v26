import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import type { Event } from "@/features/events";

/**
 * The query key of an event's registry-id lookup (`useEventUuidResult`):
 * the event's provenance, which is its identity across feed refreshes.
 * Kept apart from the hook so a screen can ask the lookup again without
 * observing it (and tests that stand the hook in keep this).
 */
export function eventUuidQueryKey(event: Event) {
  return ["event-uuid", event.provenance.provider, event.provenance.providerId] as const;
}

/**
 * Asks the registry again for `event`'s id when none is known yet: the
 * lookup failed (no connection, a refused request) or answered "no id". A
 * found id never changes and is never asked again. Only a lookup a screen
 * has already started is asked; resolves once the answer is in (offline,
 * once the connection is back) and never rejects.
 *
 * The hub's pull-to-refresh and Retry and the event page's SHAKEmap Retry
 * use it. Before, a lookup that failed was asked again only on the next
 * visit, on return to the app or when the connection came back, so after
 * one failure the hub, its pill and the felt map stayed missing however
 * often the person refreshed (2026-10-22).
 */
export async function refetchEventUuidIfMissing(
  client: QueryClient,
  event: Event,
): Promise<void> {
  const queryKey = eventUuidQueryKey(event);
  if (typeof client.getQueryData(queryKey) === "string") {
    return;
  }
  await client.refetchQueries({ queryKey, exact: true });
}

/** `refetchEventUuidIfMissing` bound to the app's query client. */
export function useRefetchEventUuidIfMissing(event: Event): () => Promise<void> {
  const client = useQueryClient();
  return useCallback(() => refetchEventUuidIfMissing(client, event), [client, event]);
}
