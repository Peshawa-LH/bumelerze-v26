import AsyncStorage from "@react-native-async-storage/async-storage";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import {
  QueryClient,
  focusManager,
  useQuery,
  type UseQueryResult,
} from "@tanstack/react-query";
import type { PersistedClient, Persister } from "@tanstack/react-query-persist-client";
import { AppState, type AppStateStatus } from "react-native";

import {
  EVENTS_REFETCH_INTERVAL_MS,
  EVENTS_STALE_TIME_MS,
} from "./config";
import { fetchUsgsEventById, fetchUsgsRegionEvents, fetchUsgsWorldEvents } from "./usgs";
import type { Event } from "./types";

/**
 * Pauses React Query's `refetchInterval` polling when the app is
 * backgrounded (PROJECT.md: "no aggressive background polling... no wake-lock
 * abuse"). React Query's `refetchIntervalInBackground` defaults to `false`,
 * but on React Native that only has an effect once `focusManager` is told
 * about app-foreground state — RN doesn't fire the DOM `visibilitychange`
 * event React Query listens to by default. No extra native dependency
 * needed (no NetInfo): `AppState` alone is enough for this wave.
 */
function onAppStateChange(status: AppStateStatus): void {
  focusManager.setFocused(status === "active");
}

let appStateListenerAttached = false;

function ensureAppStateListenerAttached(): void {
  if (appStateListenerAttached) {
    return;
  }
  appStateListenerAttached = true;
  AppState.addEventListener("change", onAppStateChange);
}

const QUERY_CACHE_KEY = "bumelerze.react-query-cache";
/** Cached data older than this is dropped on cold start rather than shown as
 * "fresh" — a week is generous for an earthquake feed cache and matches the
 * region feed's own 30-day query window loosely (stale-but-plausible). */
export const PERSISTED_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function createEventsQueryClient(): QueryClient {
  ensureAppStateListenerAttached();

  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: EVENTS_STALE_TIME_MS,
        // Cached feed must survive a cold start with no network (offline
        // requirement, PROJECT.md) — never garbage-collect it just because
        // no screen is currently mounted.
        gcTime: PERSISTED_CACHE_MAX_AGE_MS,
        retry: 2,
        refetchOnReconnect: true,
      },
    },
  });
}

export function createEventsPersister(): Persister {
  return createAsyncStoragePersister({
    storage: AsyncStorage,
    key: QUERY_CACHE_KEY,
  }) as Persister;
}

// Re-exported so app/_layout.tsx doesn't need to know the persisted-client
// type comes from a different package than the client/persister factories.
export type { PersistedClient };

export const eventsQueryKeys = {
  region: ["events", "region"] as const,
  world: ["events", "world"] as const,
};

export interface UseEventsFeedResult {
  events: Event[];
  /** True once we have rendered cache but the latest background fetch
   * failed — the "isOffline-ish" signal the wave brief asks for, derived
   * from query state rather than a NetInfo dependency: we only *have* stale
   * cached data with a failing latest fetch when the device can't reach
   * USGS, which for this app's purposes is offline enough to say so. */
  isOfflineIsh: boolean;
  /** True only when there is no cached data at all yet — the one case that
   * should show a skeleton instead of the (possibly stale) list. */
  isInitialLoading: boolean;
  /** True when there is neither cached data nor a successful fetch — the
   * error+retry state (spec-v1.md §4.1 "error state with retry"), distinct
   * from `isOfflineIsh` (which still has something to render). */
  isHardError: boolean;
  dataUpdatedAt: number;
  skippedCount: number;
  refetch: UseQueryResult["refetch"];
  isRefreshing: boolean;
}

function useEventsFeed(
  queryKey: readonly string[],
  queryFn: () => ReturnType<typeof fetchUsgsRegionEvents>,
): UseEventsFeedResult {
  const query = useQuery({
    queryKey,
    queryFn,
    refetchInterval: EVENTS_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });

  return {
    events: query.data?.events ?? [],
    isOfflineIsh: query.isError && query.data !== undefined,
    isInitialLoading: query.isPending,
    isHardError: query.isError && query.data === undefined,
    dataUpdatedAt: query.dataUpdatedAt,
    skippedCount: query.data?.skippedCount ?? 0,
    refetch: query.refetch,
    isRefreshing: query.isFetching && !query.isPending,
  };
}

/** Region-scoped feed (Home, spec-v1.md §4.1) — refetches every 60s while
 * the app is foregrounded, treats data as fresh for 30s. */
export function useRegionEvents(): UseEventsFeedResult {
  return useEventsFeed(eventsQueryKeys.region, fetchUsgsRegionEvents);
}

/** Full world feed (World Catalog, spec-v1.md §4.2). */
export function useWorldEvents(): UseEventsFeedResult {
  return useEventsFeed(eventsQueryKeys.world, fetchUsgsWorldEvents);
}

export interface UseEventByIdResult {
  event: Event | null;
  isLoading: boolean;
  isError: boolean;
}

/**
 * Single-event lookup for Event Detail's cold-start deep-link case
 * (spec-v1.md §4.5) — only fires when `enabled` is true (the caller has
 * already checked the region/world caches and come up empty) so a normal
 * in-app navigation never issues an extra network request for data it
 * already has.
 */
export function useEventById(id: string | undefined, enabled: boolean): UseEventByIdResult {
  const query = useQuery({
    queryKey: ["events", "byId", id ?? ""],
    // `enabled` guarantees `id` is defined whenever this actually runs.
    queryFn: () => fetchUsgsEventById(id as string),
    enabled: enabled && Boolean(id),
  });

  return {
    event: query.data ?? null,
    isLoading: query.isPending && enabled,
    isError: query.isError,
  };
}
