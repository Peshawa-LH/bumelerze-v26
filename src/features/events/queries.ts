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
  EMSC_REGION_TIMEOUT_MS,
  EVENTS_REFETCH_INTERVAL_MS,
  EVENTS_STALE_TIME_MS,
  USGS_REGION_TIMEOUT_MS,
} from "./config";
import { fetchEmscRegionEvents } from "./emsc";
import { mergeProviderEvents } from "./merge";
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
   * USGS, which for this app's purposes is offline enough to say so.
   *
   * Multi-provider nuance (completeness merge): for the region feed this
   * flag comes from `fetchRegionEventsMerged` (queries.ts), which only
   * rejects when BOTH USGS and EMSC fail — one provider answering is a
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

/** Shared shape of `fetchUsgsRegionEvents`'s and `fetchEmscRegionEvents`'s
 * results — both are `{ events, skippedCount, fetchedAt }`, the merge
 * orchestration below doesn't care which provider produced them. */
interface RegionFetchResult {
  events: Event[];
  skippedCount: number;
  fetchedAt: number;
}

/** One provider's leg of the parallel region fetch: its own AbortController
 * timeout budget, resolving to the result or `undefined` on any failure
 * (rejection or timeout) — never throwing, so `Promise.all` over both legs
 * can't short-circuit on the first failure. The failure itself is kept for
 * the both-fail rethrow in `fetchRegionEventsMerged`. */
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
 * Region feed fetch: USGS and EMSC queried IN PARALLEL, results merged
 * through `mergeProviderEvents` (merge.ts) — a completeness MERGE, not the
 * old availability failover. Exported so it can be exercised directly in
 * tests without standing up a full QueryClient/renderHook harness.
 *
 * Why merge instead of failover — a real missed earthquake: 2026-08-13
 * 22:28 UTC, M4.0 mb, Iran–Iraq border region. In EMSC's catalog, absent
 * from USGS entirely (below NEIC's ~M4.5 regional completeness). Under
 * failover semantics EMSC was only consulted when USGS *failed*, so that
 * felt regional event never surfaced while USGS was healthy. Both catalogs
 * are now always consulted; EMSC fills USGS's regional completeness gap and
 * USGS stays canonical where they overlap (event-pipeline-design.md §2).
 *
 * Semantics, per outcome — degraded modes stay truthful:
 * 1. BOTH succeed → `mergeProviderEvents(usgs, emsc)`: USGS events as-is,
 *    EMSC-only events appended with provider "emsc", cross-provider
 *    duplicates dropped in EMSC's favor of USGS. `skippedCount` sums both
 *    providers' tolerant-parsing skips.
 * 2. USGS-only succeeds → merged(USGS, []) ≡ the USGS list, exactly what
 *    the old failover served on a healthy poll. EMSC-only events already in
 *    the previous poll's cache disappear until EMSC answers again — the
 *    truthful representation of "we can only see USGS right now".
 * 3. EMSC-only succeeds → the EMSC list (the old failover outcome, now a
 *    natural special case of the merge rather than a separate code path).
 * 4. BOTH fail → the USGS failure rethrows unchanged to React Query — the
 *    existing isOfflineIsh/isHardError states in `useEventsFeed` keep
 *    working exactly as before.
 *
 * Each provider gets its OWN timeout budget (config.ts) — a slow provider
 * is dropped from this poll's merge, never allowed to block the other one.
 * This remains a plain `queryFn` under the single `eventsQueryKeys.region`
 * key: each poll's merged list wholesale-replaces the previous one, so
 * provider recovery needs no cache surgery.
 */
export async function fetchRegionEventsMerged(): Promise<RegionFetchResult> {
  const [usgs, emsc] = await Promise.all([
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
  ]);

  if (!usgs.result && !emsc.result) {
    // Both-fail path (outcome 4): rethrow rather than fabricate an empty
    // feed — an empty list would render as "no earthquakes", a lie.
    throw usgs.error ?? emsc.error ?? new Error("region fetch failed for both providers");
  }

  const usgsEvents = usgs.result?.events ?? [];
  const emscEvents = emsc.result?.events ?? [];

  return {
    events: mergeProviderEvents(usgsEvents, emscEvents),
    skippedCount: (usgs.result?.skippedCount ?? 0) + (emsc.result?.skippedCount ?? 0),
    fetchedAt: Math.max(usgs.result?.fetchedAt ?? 0, emsc.result?.fetchedAt ?? 0),
  };
}

/** Region-scoped feed (Home, spec-v1.md §4.1) — refetches every 60s while
 * the app is foregrounded, treats data as fresh for 30s. Parallel
 * USGS+EMSC completeness merge via `fetchRegionEventsMerged` above;
 * `useEventsFeed`'s offline/error derivation is unaffected — it only cares
 * whether the combined fetch succeeded or failed, not which provider(s)
 * answered. */
export function useRegionEvents(): UseEventsFeedResult {
  return useEventsFeed(eventsQueryKeys.region, fetchRegionEventsMerged);
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
