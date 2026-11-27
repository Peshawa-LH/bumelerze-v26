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
import {
  findHidden,
  useHiddenEarthquakes,
  type HiddenEarthquake,
} from "@/features/home-extras";

export interface RouteEvent {
  event: Event | null;
  isLoading: boolean;
  isNotFound: boolean;
  /** The route param is a `bml` id (not a provider id). */
  routeIsBumelerzeId: boolean;
  /** The bml id of a curated Historical event reached by its provider id. */
  staticBumelerzeIdAlias: string | null;
  /** Set when Bumelerze hid this earthquake for everyone (migration 0085):
   * the route id, or the resolved event's own ids, are in the hidden list.
   * The page decides what to show (`useHiddenRouteGate`). */
  hidden: HiddenEarthquake | null;
}

/**
 * Resolves an `/event/[id]`-style route param to an `Event`: the cached
 * region/world feeds first (the common case), else a direct lookup (Supabase
 * for a `bml` id, the USGS `byId` fetch for a provider id). Shared by the
 * event page and the Event hub so both accept exactly the same ids. Also
 * says whether the earthquake is hidden for everyone (migration 0085), by
 * id only: the route id first (known before any fetch), then the event's
 * own ids. The hidden list is the one Home keeps on the device; a page
 * never waits for it (a link must open on a weak network), so a first-time
 * visitor may see a hidden earthquake for the moment the one read takes.
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
  }, [
    region.events,
    world.events,
    routeId,
    routeIsBumelerzeId,
    cacheProviderIdCandidate,
  ]);

  // A provider-id route only ever fetches via the USGS `byId` fdsnws lookup;
  // a bml-id route (no cache hit, and no static curated alias to have
  // already matched above) falls back to Supabase directly. Neither waits
  // for the feeds to finish loading: a link opened with no saved list would
  // otherwise sit behind the slowest feed source (up to its 8 s timeout —
  // GEOFON, 2026-10-21). A cache hit still costs no request.
  const shouldFetchById = !cachedEvent && !routeIsBumelerzeId && routeId !== "";
  const byId = useEventById(routeIsBumelerzeId ? undefined : routeId, shouldFetchById);

  const shouldFetchByBumelerzeId = !cachedEvent && routeIsBumelerzeId;
  const byBumelerzeId = useEventByBumelerzeId(
    routeIsBumelerzeId ? routeId : undefined,
    shouldFetchByBumelerzeId,
  );

  const event = cachedEvent ?? (routeIsBumelerzeId ? byBumelerzeId.event : byId.event);

  const hiddenIndex = useHiddenEarthquakes();
  const hidden = useMemo(
    () =>
      findHidden(hiddenIndex, [
        routeId,
        staticProviderIdAlias,
        staticBumelerzeIdAlias,
        event?.id,
        event?.provenance.providerId,
        event?.bumelerzeId,
      ]),
    [hiddenIndex, routeId, staticProviderIdAlias, staticBumelerzeIdAlias, event],
  );

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
    hidden,
  };
}
