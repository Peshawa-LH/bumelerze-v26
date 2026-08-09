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
  USGS_REGION_TIMEOUT_MS,
} from "./config";
import { fetchEmscRegionEvents } from "./emsc";
import { fetchUsgsEventById, fetchUsgsRegionEvents, fetchUsgsWorldEvents } from "./usgs";
import type { Event, EventProvider } from "./types";

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

/** Shared shape of `fetchUsgsRegionEvents`'s and `fetchEmscRegionEvents`'s
 * results — both are `{ events, skippedCount, fetchedAt }`, the failover
 * orchestration below doesn't care which provider produced them. */
interface RegionFetchResult {
  events: Event[];
  skippedCount: number;
  fetchedAt: number;
}

/**
 * Dev-only invariant check (wave brief point 2: "assert single-provider
 * lists in the code path"). Only ONE provider's list is ever served per
 * region fetch — this is failover, not merge — so cross-provider dedup
 * (event-pipeline-design.md §2's 16s/100km/|ΔM|≤1.5 spatial-temporal match)
 * is deliberately NOT implemented client-side this wave; merging
 * simultaneously-live USGS + EMSC records is the future server-side
 * worker's job. This check exists to catch a future regression (e.g. a
 * change that accidentally concatenates both providers' events) rather
 * than to guard any currently-reachable runtime state, so it only throws in
 * `__DEV__` (including under Jest) — never a crash risk in production,
 * consistent with this codebase's tolerant-parsing stance elsewhere.
 */
function assertSingleProvider(events: Event[], provider: EventProvider): void {
  if (!__DEV__) {
    return;
  }
  const wrongProvider = events.find((event) => event.provenance.provider !== provider);
  if (wrongProvider) {
    throw new Error(
      `[events/queries] region failover invariant violated: expected all events from "${provider}", got "${wrongProvider.provenance.provider}"`,
    );
  }
}

/**
 * Region feed fetch: USGS-primary with EMSC fallback (D4 second tier —
 * "when USGS is slow or unreachable... fails over to EMSC"). Exported so it
 * can be exercised directly in tests without standing up a full
 * QueryClient/renderHook harness.
 *
 * Failover semantics:
 * 1. Try USGS, aborting after `USGS_REGION_TIMEOUT_MS` (config.ts) if it
 *    hasn't resolved — a slow regional network is exactly the scenario this
 *    wave exists for.
 * 2. If USGS rejects OR times out, try EMSC once. A successful EMSC fetch
 *    is served as-is (all events tagged `provenance.provider: "emsc"` by
 *    `normalizeEmscFeature` — nothing here relabels them).
 * 3. If EMSC ALSO fails, the rejection propagates to the caller (React
 *    Query) unchanged — this function does not swallow a double failure,
 *    so the existing isOfflineIsh/isHardError states in `useEventsFeed`
 *    keep working exactly as before this wave.
 *
 * Recovery swap: this is a plain `queryFn` under the SAME `eventsQueryKeys.
 * region` query key USGS always used — there's no separate "EMSC query" the
 * UI has to know about. The next poll (still on the 60s interval) simply
 * tries USGS again; once USGS answers, its events *replace* the previously-
 * cached EMSC events under that one key, exactly like any other refetch.
 * No merge, no manual cache surgery — React Query's normal
 * queryFn-replaces-cached-data behavior is sufficient.
 */
export async function fetchRegionEventsWithFailover(): Promise<RegionFetchResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), USGS_REGION_TIMEOUT_MS);

  let usgsResult: RegionFetchResult | undefined;
  try {
    usgsResult = await fetchUsgsRegionEvents(controller.signal);
  } catch (usgsError) {
    if (__DEV__) {
      console.warn(
        "[events/queries] USGS region fetch failed or timed out, trying EMSC fallback",
        usgsError,
      );
    }
  } finally {
    clearTimeout(timeoutId);
  }

  if (usgsResult) {
    assertSingleProvider(usgsResult.events, "usgs");
    return usgsResult;
  }

  // Both the plain-rejection and the abort-timeout paths land here. If this
  // also throws, it propagates uncaught to React Query — the "both fail"
  // case in the wave brief, deliberately not caught here.
  const emscResult = await fetchEmscRegionEvents();
  assertSingleProvider(emscResult.events, "emsc");
  return emscResult;
}

/** Region-scoped feed (Home, spec-v1.md §4.1) — refetches every 60s while
 * the app is foregrounded, treats data as fresh for 30s. USGS-primary with
 * EMSC fallback (D4 second tier) via `fetchRegionEventsWithFailover` above;
 * `useEventsFeed`'s offline/error derivation is unaffected — it only cares
 * whether the combined fetch succeeded or failed, not which provider
 * answered. */
export function useRegionEvents(): UseEventsFeedResult {
  return useEventsFeed(eventsQueryKeys.region, fetchRegionEventsWithFailover);
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
