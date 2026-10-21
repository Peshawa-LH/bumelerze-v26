import AsyncStorage from "@react-native-async-storage/async-storage";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import {
  QueryClient,
  focusManager,
  onlineManager,
  useIsRestoring,
  useQuery,
  type UseQueryResult,
} from "@tanstack/react-query";
import type { PersistedClient, Persister } from "@tanstack/react-query-persist-client";
import { useSyncExternalStore } from "react";
import { AppState, Platform, type AppStateStatus } from "react-native";

// Type only: the NetInfo adapter itself is handed in by app/_layout.tsx, so
// importing this module never loads a native module (tests, web).
import type { DeviceConnectivitySubscribe } from "@/lib/device-connectivity";
import { persistLastGoodData } from "@/lib/persist-filter";

import {
  EMSC_REGION_TIMEOUT_MS,
  EVENTS_REFETCH_INTERVAL_MS,
  EVENTS_STALE_TIME_MS,
  GEOFON_REGION_TIMEOUT_MS,
  NOTABLE_TAIL_STALE_TIME_MS,
  USGS_REGION_TIMEOUT_MS,
} from "./config";
import { fetchEmscRegionEvents } from "./emsc";
import { fetchGeofonRegionEvents } from "./geofon";
import { mergeProviderEvents } from "./merge";
import {
  fetchUsgsEventById,
  fetchUsgsNotableTailEvents,
  fetchUsgsRegionEvents,
  fetchUsgsWorldEvents,
} from "./usgs";
import type { Event } from "./types";

/**
 * Pauses React Query's `refetchInterval` polling when the app is
 * backgrounded (the project requirements: "no aggressive background polling... no wake-lock
 * abuse"). React Query's `refetchIntervalInBackground` defaults to `false`,
 * but on React Native that only has an effect once `focusManager` is told
 * about app-foreground state — RN doesn't fire the DOM `visibilitychange`
 * event React Query listens to by default. `AppState` alone is enough for
 * that; the connection itself is `followDeviceConnectivity`'s job.
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

/**
 * Web: React Query follows the browser's online/offline events, but starts
 * out assuming "online". A page opened without signal (the offline copy,
 * public/push-sw.js) would then try the feed, wait for the retries to fail
 * and only then say so. `navigator.onLine === false` is reliable (it is
 * `true` that can be wrong), so start from it. iOS/Android follow the
 * phone's connection instead (`followDeviceConnectivity`).
 */
function seedOnlineStateWeb(): void {
  if (
    Platform.OS === "web" &&
    typeof navigator !== "undefined" &&
    navigator.onLine === false
  ) {
    onlineManager.setOnline(false);
  }
}

/**
 * iOS/Android: React Query follows the phone's connection (NetInfo,
 * `src/lib/device-connectivity.ts`), as the web follows the browser's.
 * Before this, an app opened without signal assumed "online": the feed
 * tried, waited for its retries to fail and only then said so, and nothing
 * refetched when the signal came back. Now, offline, queries pause (the
 * saved feed shows at once with the offline note) and resume when the
 * connection returns (`refetchOnReconnect`). Not yet known counts as
 * online, so a slow first answer never blocks the first fetch.
 */
export function followDeviceConnectivity(subscribe: DeviceConnectivitySubscribe): void {
  onlineManager.setEventListener((setOnline) =>
    subscribe((isConnected) => setOnline(isConnected !== false)),
  );
}

/**
 * Calls `onReconnect` each time the connection comes back after React Query
 * saw it lost (not on start, not while it stays online). Returns the
 * function that stops listening.
 */
export function onConnectionRegained(onReconnect: () => void): () => void {
  let wasOnline = onlineManager.isOnline();
  return onlineManager.subscribe((isOnline) => {
    if (isOnline && !wasOnline) {
      onReconnect();
    }
    wasOnline = isOnline;
  });
}

/** Whether React Query believes the device is online (web: the browser's
 * online/offline events; iOS/Android: the phone's connection, NetInfo). */
export function useIsOnline(): boolean {
  return useSyncExternalStore(
    (onChange) => onlineManager.subscribe(onChange),
    () => onlineManager.isOnline(),
    () => true,
  );
}

export interface EventsQueryClientOptions {
  /** iOS/Android: the phone's connection signal (NetInfo); none on the web. */
  deviceConnectivity?: DeviceConnectivitySubscribe | null;
}

export function createEventsQueryClient(
  options: EventsQueryClientOptions = {},
): QueryClient {
  ensureAppStateListenerAttached();
  seedOnlineStateWeb();
  if (Platform.OS !== "web" && options.deviceConnectivity) {
    followDeviceConnectivity(options.deviceConnectivity);
  }

  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: EVENTS_STALE_TIME_MS,
        // Cached feed must survive a cold start with no network (offline
        // requirement, the project requirements) — never garbage-collect it just because
        // no screen is currently mounted.
        gcTime: PERSISTED_CACHE_MAX_AGE_MS,
        retry: 2,
        refetchOnReconnect: true,
      },
    },
  });
}

/**
 * The device copy of the React Query cache. A query whose latest refresh
 * failed is written as its last good result (`persistLastGoodData`), so a
 * failed refresh never removes or replaces the saved feed or maps.
 */
export function createEventsPersister(): Persister {
  return persistLastGoodData(
    createAsyncStoragePersister({
      storage: AsyncStorage,
      key: QUERY_CACHE_KEY,
    }) as Persister,
  );
}

// Re-exported so app/_layout.tsx doesn't need to know the persisted-client
// type comes from a different package than the client/persister factories.
export type { PersistedClient };

export const eventsQueryKeys = {
  region: ["events", "region"] as const,
  world: ["events", "world"] as const,
  notableTail: ["events", "notableTail"] as const,
};

export interface UseEventsFeedResult {
  events: Event[];
  /** True once we have rendered cache but the latest background fetch
   * failed — the "isOffline-ish" signal the brief asks for, derived
   * from query state rather than a NetInfo dependency: we only *have* stale
   * cached data with a failing latest fetch when the device can't reach
   * USGS, which for this app's purposes is offline enough to say so.
   *
   * Multi-provider nuance (completeness merge): for the region feed this
   * flag comes from `fetchRegionEventsMerged` (queries.ts), which only
   * rejects when ALL providers (USGS, EMSC, GEOFON) fail — one provider
   * answering is a
   * successful query, `query.isError` stays `false`, and this stays `false`
   * too. So a device that's happily getting live data from either provider
   * correctly never sees the offline banner — the existing "via EMSC"
   * provenance chip on each event card is the truthful, non-alarming
   * signal of which provider supplied an individual event; no separate
   * banner needed. */
  isOfflineIsh: boolean;
  /** True only when there is no cached data at all yet — the one case that
   * should show a skeleton instead of the (possibly stale) list. */
  isInitialLoading: boolean;
  /** True when there is neither cached data nor a successful fetch — the
   * error+retry state (the v1 spec §4.1 "error state with retry"), distinct
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
  // When the browser (web) or the phone (iOS/Android) goes offline React
  // Query PAUSES the feed instead of failing it, so `isError` alone never
  // turned true and the offline banner never showed (found 2026-10-13).
  // Offline is now said straight away.
  const isOnline = useIsOnline();
  // While the saved feed is still being read back, nothing is decided yet.
  const isRestoring = useIsRestoring();
  const offlineWithoutFetch =
    !isOnline && !isRestoring && query.fetchStatus !== "fetching";
  const hasData = query.data !== undefined;

  return {
    events: query.data?.events ?? [],
    isOfflineIsh: hasData && (query.isError || offlineWithoutFetch),
    isInitialLoading: query.isPending && !offlineWithoutFetch,
    isHardError: !hasData && (query.isError || offlineWithoutFetch),
    dataUpdatedAt: query.dataUpdatedAt,
    skippedCount: query.data?.skippedCount ?? 0,
    refetch: query.refetch,
    isRefreshing: query.isFetching && !query.isPending,
  };
}

/** Shared shape of `fetchUsgsRegionEvents`'s, `fetchEmscRegionEvents`'s,
 * and `fetchGeofonRegionEvents`'s results — all are `{ events,
 * skippedCount, fetchedAt }`, the merge orchestration below doesn't care
 * which provider produced them. This shape IS the provider fetch contract:
 * a future source's fetch fn returns it and joins the leg list below
 * (the provider-architecture notes). */
interface RegionFetchResult {
  events: Event[];
  skippedCount: number;
  fetchedAt: number;
}

/** One provider's leg of the parallel region fetch: its own AbortController
 * timeout budget, resolving to the result or `undefined` on any failure
 * (rejection or timeout) — never throwing, so `Promise.all` over the legs
 * can't short-circuit on the first failure. The failure itself is kept for
 * the all-fail rethrow in `fetchRegionEventsMerged`. */
async function fetchProviderLeg(
  fetchFn: (signal: AbortSignal) => Promise<RegionFetchResult>,
  timeoutMs: number,
  providerLabel: string,
): Promise<{ result?: RegionFetchResult; error?: unknown }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return { result: await fetchFn(controller.signal) };
  } catch (error) {
    if (__DEV__) {
      console.warn(
        `[events/queries] ${providerLabel} region fetch failed or timed out — serving the other provider's list alone this poll`,
        error,
      );
    }
    return { error };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Region feed fetch: USGS, EMSC, and GEOFON queried IN PARALLEL, results
 * merged through `mergeProviderEvents` (merge.ts) — a completeness MERGE,
 * not the old availability failover. Exported so it can be exercised
 * directly in tests without standing up a full QueryClient/renderHook
 * harness.
 *
 * Why merge instead of failover — a real missed earthquake: 2026-08-13
 * 22:28 UTC, M4.0 mb, Iran–Iraq border region. In EMSC's catalog, absent
 * from USGS entirely (below NEIC's ~M4.5 regional completeness). Under
 * failover semantics EMSC was only consulted when USGS *failed*, so that
 * felt regional event never surfaced while USGS was healthy. All catalogs
 * are now always consulted; each lower-authority catalog fills the
 * completeness gaps of the ones above it, and the highest-authority record
 * stays canonical where they overlap (the event-pipeline design §2, D4
 * order: USGS > EMSC > GEOFON — the leg-list order below IS the merge's
 * priority order; a future provider joins by adding a leg at its authority
 * position, see the provider-architecture notes).
 *
 * Semantics, per outcome — degraded modes stay truthful:
 * 1. ALL succeed → `mergeProviderEvents([usgs, emsc, geofon])`: USGS
 *    events as-is, lower-priority-only events appended with their own
 *    provider tag, cross-provider duplicates dropped in the higher
 *    authority's favor. `skippedCount` sums every provider's
 *    tolerant-parsing skips.
 * 2. A SUBSET succeeds → the merge over the successful legs' lists (a
 *    failed leg contributes an empty list — the single-provider outcomes
 *    of the old two-way merge are natural special cases of this).
 *    Provider-exclusive events from a failed leg's previous poll disappear
 *    until that provider answers again — the truthful representation of
 *    "this is all we can see right now".
 * 3. ALL fail → the USGS failure (or the first leg failure available)
 *    rethrows unchanged to React Query — the existing
 *    isOfflineIsh/isHardError states in `useEventsFeed` keep working
 *    exactly as before.
 *
 * Each provider gets its OWN timeout budget (config.ts) — a slow provider
 * is dropped from this poll's merge, never allowed to block the others.
 * This remains a plain `queryFn` under the single `eventsQueryKeys.region`
 * key: each poll's merged list wholesale-replaces the previous one, so
 * provider recovery needs no cache surgery.
 */
export async function fetchRegionEventsMerged(): Promise<RegionFetchResult> {
  // Leg order = canonical authority order (doc comment above) — it is the
  // priority order `mergeProviderEvents` applies.
  const legs = await Promise.all([
    fetchProviderLeg(
      (signal) => fetchUsgsRegionEvents(signal),
      USGS_REGION_TIMEOUT_MS,
      "USGS",
    ),
    fetchProviderLeg(
      (signal) => fetchEmscRegionEvents(signal),
      EMSC_REGION_TIMEOUT_MS,
      "EMSC",
    ),
    fetchProviderLeg(
      (signal) => fetchGeofonRegionEvents(signal),
      GEOFON_REGION_TIMEOUT_MS,
      "GEOFON",
    ),
  ]);

  if (legs.every((leg) => !leg.result)) {
    // All-fail path (outcome 3): rethrow rather than fabricate an empty
    // feed — an empty list would render as "no earthquakes", a lie.
    throw (
      legs.find((leg) => leg.error !== undefined)?.error ??
      new Error("region fetch failed for all providers")
    );
  }

  return {
    events: mergeProviderEvents(legs.map((leg) => leg.result?.events ?? [])),
    skippedCount: legs.reduce((sum, leg) => sum + (leg.result?.skippedCount ?? 0), 0),
    fetchedAt: Math.max(...legs.map((leg) => leg.result?.fetchedAt ?? 0)),
  };
}

/** Region-scoped feed (Home, the v1 spec §4.1) — refetches every 60s while
 * the app is foregrounded, treats data as fresh for 30s. Parallel
 * USGS+EMSC+GEOFON completeness merge via `fetchRegionEventsMerged` above;
 * `useEventsFeed`'s offline/error derivation is unaffected — it only cares
 * whether the combined fetch succeeded or failed, not which provider(s)
 * answered. */
export function useRegionEvents(): UseEventsFeedResult {
  return useEventsFeed(eventsQueryKeys.region, fetchRegionEventsMerged);
}

/** Full world feed (World Catalog, the v1 spec §4.2). */
export function useWorldEvents(): UseEventsFeedResult {
  return useEventsFeed(eventsQueryKeys.world, fetchUsgsWorldEvents);
}

export interface UseNotableTailEventsResult {
  events: Event[];
}

/**
 * Notable-tail feed (config.ts `NOTABLE_TAIL_*`, `home-feed-policy.ts`'s
 * M>=6/12-month carve-out) — deliberately NOT built on `useEventsFeed`:
 * no `refetchInterval` (refetches only on mount/remount, e.g. app
 * foreground), and a long `staleTime` override, since this query only
 * backfills a rare, slow-changing tail (see usgs.ts's
 * `fetchUsgsNotableTailEvents` doc comment for the full reasoning). A
 * failure here silently falls back to an empty array — this is a "nice to
 * have a bit more history" query, not safety-path data, so it never blocks
 * or degrades Home's primary offline/error states.
 */
export function useNotableTailEvents(): UseNotableTailEventsResult {
  const query = useQuery({
    queryKey: eventsQueryKeys.notableTail,
    queryFn: () => fetchUsgsNotableTailEvents(),
    staleTime: NOTABLE_TAIL_STALE_TIME_MS,
  });

  return { events: query.data?.events ?? [] };
}

export interface UseEventByIdResult {
  event: Event | null;
  isLoading: boolean;
  isError: boolean;
}

/**
 * Single-event lookup for Event Detail's cold-start deep-link case
 * (the v1 spec §4.5) — only fires when `enabled` is true (the caller has
 * already checked the region/world caches and come up empty) so a normal
 * in-app navigation never issues an extra network request for data it
 * already has.
 */
export function useEventById(
  id: string | undefined,
  enabled: boolean,
): UseEventByIdResult {
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
