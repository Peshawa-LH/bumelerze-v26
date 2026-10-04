import { useMemo } from "react";

import {
  isBumelerzeId,
  useEventByBumelerzeId,
  useEventById,
  useRegionEvents,
  useWorldEvents,
  type Event,
} from "@/features/events";
import {
  NOTABLE_BUMELERZE_ID_BY_PROVIDER_ID,
  NOTABLE_PROVIDER_ID_BY_BUMELERZE_ID,
} from "@/features/historical";

export interface RouteEvent {
  event: Event | null;
  isLoading: boolean;
  isNotFound: boolean;
  /** The route param is a `bml` id (not a provider id). */
  routeIsBumelerzeId: boolean;
  /** The bml id of a curated Historical event reached by its provider id. */
  staticBumelerzeIdAlias: string | null;
}

/**
 * Resolves an `/event/[id]`-style route param to an `Event`: the cached
 * region/world feeds first (the common case), else a direct lookup (Supabase
 * for a `bml` id, the USGS `byId` fetch for a provider id). Shared by the
 * event page and the Event hub so both accept exactly the same ids.
 */
export function useRouteEvent(id: string | undefined): RouteEvent {
  const routeId = id ?? "";
  const routeIsBumelerzeId = routeId !== "" && isBumelerzeId(routeId);
  // Static, offline, zero-cost: only ever non-null for the 11 curated
  // Historical events, in whichever direction the route param needs.
  const staticProviderIdAlias = routeIsBumelerzeId
    ? (NOTABLE_PROVIDER_ID_BY_BUMELERZE_ID.get(routeId) ?? null)
    : null;
  const staticBumelerzeIdAlias = !routeIsBumelerzeId
    ? (NOTABLE_BUMELERZE_ID_BY_PROVIDER_ID.get(routeId) ?? null)
    : null;

  const region = useRegionEvents();
  const world = useWorldEvents();

  // The provider id a cached feed event would carry for THIS route param —
  // either the param itself (a provider-id route) or its curated alias (a
  // bml-id route for one of the 11 Historical events).
  const cacheProviderIdCandidate = routeIsBumelerzeId ? staticProviderIdAlias : routeId;

  const cachedEvent = useMemo(() => {
    if (routeIsBumelerzeId) {
      const byBumelerzeId =
        region.events.find((event) => event.bumelerzeId === routeId) ??
        world.events.find((event) => event.bumelerzeId === routeId) ??
        null;
      if (byBumelerzeId) {
        return byBumelerzeId;
      }
    }
    if (!cacheProviderIdCandidate) {
      return null;
    }
    return (
      region.events.find((event) => event.id === cacheProviderIdCandidate) ??
      world.events.find((event) => event.id === cacheProviderIdCandidate) ??
      null
    );
  }, [region.events, world.events, routeId, routeIsBumelerzeId, cacheProviderIdCandidate]);

  // A provider-id route only ever fetches via the USGS `byId` fdsnws lookup;
  // a bml-id route (no cache hit, and no static curated alias to have
  // already matched above) falls back to Supabase directly.
  const shouldFetchById =
    !cachedEvent &&
    !routeIsBumelerzeId &&
    routeId !== "" &&
    !region.isInitialLoading &&
    !world.isInitialLoading;
  const byId = useEventById(routeIsBumelerzeId ? undefined : routeId, shouldFetchById);

  const shouldFetchByBumelerzeId =
    !cachedEvent &&
    routeIsBumelerzeId &&
    !region.isInitialLoading &&
    !world.isInitialLoading;
  const byBumelerzeId = useEventByBumelerzeId(
    routeIsBumelerzeId ? routeId : undefined,
    shouldFetchByBumelerzeId,
  );

  const event = cachedEvent ?? (routeIsBumelerzeId ? byBumelerzeId.event : byId.event);
  const isLoading =
    !event &&
    (region.isInitialLoading ||
      world.isInitialLoading ||
      (routeIsBumelerzeId ? byBumelerzeId.isLoading : byId.isLoading));

  return {
    event,
    isLoading,
    isNotFound: !event && !isLoading,
    routeIsBumelerzeId,
    staticBumelerzeIdAlias,
  };
}
