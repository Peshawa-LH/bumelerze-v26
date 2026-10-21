/**
 * The saved feed survives a failed refresh. Found 2026-10-21: on a network
 * that is connected but reaches nothing, the feed's background refresh
 * failed; the on-device cache then saved everything EXCEPT the feed (it saved
 * successful queries only), and the app reopened without a connection said
 * "Couldn't load the latest events" instead of showing the saved list.
 *
 * Uses the app's own query client, persister and persist filter (as
 * app/_layout.tsx wires them) with the jest AsyncStorage mock; only the three
 * provider fetches are mocked.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { onlineManager, type QueryClient } from "@tanstack/react-query";
import {
  PersistQueryClientProvider,
  type PersistedClient,
} from "@tanstack/react-query-persist-client";
import { renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import React from "react";

import { shouldPersistQuery } from "@/lib/persist-filter";

import { fetchEmscRegionEvents } from "../emsc";
import { fetchGeofonRegionEvents } from "../geofon";
import {
  createEventsPersister,
  createEventsQueryClient,
  eventsQueryKeys,
  PERSISTED_CACHE_MAX_AGE_MS,
  useRegionEvents,
} from "../queries";
import type { Event } from "../types";
import { fetchUsgsRegionEvents } from "../usgs";

jest.mock("../usgs", () => ({
  fetchUsgsRegionEvents: jest.fn(),
  fetchUsgsWorldEvents: jest.fn(),
  fetchUsgsEventById: jest.fn(),
  fetchUsgsNotableTailEvents: jest.fn(),
}));
jest.mock("../emsc", () => ({ fetchEmscRegionEvents: jest.fn() }));
jest.mock("../geofon", () => ({ fetchGeofonRegionEvents: jest.fn() }));

const mockedUsgs = fetchUsgsRegionEvents as jest.MockedFunction<
  typeof fetchUsgsRegionEvents
>;
const mockedEmsc = fetchEmscRegionEvents as jest.MockedFunction<
  typeof fetchEmscRegionEvents
>;
const mockedGeofon = fetchGeofonRegionEvents as jest.MockedFunction<
  typeof fetchGeofonRegionEvents
>;

/** The key `createEventsPersister` saves under (queries.ts). */
const STORAGE_KEY = "bumelerze.react-query-cache";

function event(id: string): Event {
  return {
    id,
    bumelerzeId: null,
    originTime: Date.UTC(2026, 9, 20, 8, 0, 0),
    lat: 35.56,
    lon: 45.43,
    depthKm: 10,
    magnitude: { value: 4.4, type: "mb" },
    placeName: "Sulaymaniyah, Iraq",
    provenance: {
      provider: "usgs",
      providerId: id,
      fetchedAt: Date.now(),
      providerUpdatedAt: Date.now(),
    },
    sig: 300,
    isRegional: true,
    url: "",
  };
}

function providersAnswer(events: Event[]): void {
  mockedUsgs.mockResolvedValue({ events, skippedCount: 0, fetchedAt: Date.now() });
  mockedEmsc.mockResolvedValue({ events: [], skippedCount: 0, fetchedAt: Date.now() });
  mockedGeofon.mockResolvedValue({ events: [], skippedCount: 0, fetchedAt: Date.now() });
}

/** "Connected but no internet": every provider request fails. */
function providersFail(): void {
  const failure = new TypeError("Network request failed");
  mockedUsgs.mockRejectedValue(failure);
  mockedEmsc.mockRejectedValue(failure);
  mockedGeofon.mockRejectedValue(failure);
}

/** Every client a test started; closed after each test so no week-long
 * cache timer keeps Jest running, also when a test fails part-way. */
const startedClients: QueryClient[] = [];

/** Closes one app start. A fetch still waiting for a connection is cancelled
 * before the cache is cleared: cancelled after, it would start a new
 * week-long cache timer on its way out. */
async function closeApp(client: QueryClient): Promise<void> {
  await client.cancelQueries();
  client.clear();
}

/** One app start: the app's own client, without the retry delays. */
function startApp(): QueryClient {
  const client = createEventsQueryClient();
  client.setDefaultOptions({
    queries: { ...client.getDefaultOptions().queries, retry: false },
  });
  startedClients.push(client);
  return client;
}

/** The provider app/_layout.tsx renders, with the same persist options. */
function persistedWrapper(client: QueryClient) {
  const persistOptions = {
    persister: createEventsPersister(),
    maxAge: PERSISTED_CACHE_MAX_AGE_MS,
    dehydrateOptions: { shouldDehydrateQuery: shouldPersistQuery },
    buster: "events-v1",
  };
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <PersistQueryClientProvider client={client} persistOptions={persistOptions}>
        {children}
      </PersistQueryClientProvider>
    );
  };
}

/** The copy of the cache most recently written to the device. */
function lastSavedCopy(): PersistedClient | null {
  const saves = jest
    .mocked(AsyncStorage.setItem)
    .mock.calls.filter(([key]) => key === STORAGE_KEY);
  const raw = saves.at(-1)?.[1];
  return raw ? (JSON.parse(raw) as PersistedClient) : null;
}

/**
 * First session: the feed loads, then a refresh fails on a network that
 * reaches nothing. Resolves once the save that follows the failure is on
 * the device. Returns when the feed last loaded.
 */
async function loadThenFailARefresh(): Promise<number> {
  const client = startApp();
  providersAnswer([event("us7000abcd")]);
  const { result, unmount } = await renderHook(() => useRegionEvents(), {
    wrapper: persistedWrapper(client),
  });
  await waitFor(() =>
    expect(result.current.events.map((item) => item.id)).toEqual(["us7000abcd"]),
  );
  const loadedAt = result.current.dataUpdatedAt;

  providersFail();
  void result.current.refetch();
  await waitFor(() => expect(result.current.isOfflineIsh).toBe(true));
  const failedAt = client.getQueryState(eventsQueryKeys.region)?.errorUpdatedAt ?? 0;
  expect(failedAt).toBeGreaterThan(0);
  // Saves are throttled (one a second); wait for the one made at the failure.
  await waitFor(
    () => expect(lastSavedCopy()?.timestamp ?? 0).toBeGreaterThanOrEqual(failedAt),
    { timeout: 3000 },
  );

  await unmount();
  await closeApp(client);
  return loadedAt;
}

let warn: jest.SpyInstance;

beforeEach(async () => {
  await AsyncStorage.clear();
  onlineManager.setOnline(true);
  // fetchProviderLeg warns in development about every failed provider.
  warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(async () => {
  for (const client of startedClients.splice(0)) {
    await closeApp(client);
  }
  onlineManager.setOnline(true);
  warn.mockRestore();
  mockedUsgs.mockReset();
  mockedEmsc.mockReset();
  mockedGeofon.mockReset();
});

describe("the saved feed after a failed refresh", () => {
  it("shows the saved list with the offline note when the app reopens offline", async () => {
    const loadedAt = await loadThenFailARefresh();

    onlineManager.setOnline(false);
    const client = startApp();
    const { result, unmount } = await renderHook(() => useRegionEvents(), {
      wrapper: persistedWrapper(client),
    });

    await waitFor(() =>
      expect(result.current.isOfflineIsh || result.current.isHardError).toBe(true),
    );
    expect(result.current.isHardError).toBe(false);
    expect(result.current.isOfflineIsh).toBe(true);
    expect(result.current.events.map((item) => item.id)).toEqual(["us7000abcd"]);
    // "Events from …" names the last successful load, not the failed one.
    expect(result.current.dataUpdatedAt).toBe(loadedAt);

    await unmount();
    await closeApp(client);
  });

  it("shows the saved list when the app reopens on a network that still reaches nothing", async () => {
    await loadThenFailARefresh();

    providersFail();
    const client = startApp();
    const { result, unmount } = await renderHook(() => useRegionEvents(), {
      wrapper: persistedWrapper(client),
    });

    await waitFor(() =>
      expect(result.current.isOfflineIsh || result.current.isHardError).toBe(true),
    );
    expect(result.current.isHardError).toBe(false);
    expect(result.current.events.map((item) => item.id)).toEqual(["us7000abcd"]);

    await unmount();
    await closeApp(client);
  });

  it("reopened online, shows the saved list as saved data (no offline note) while it refreshes", async () => {
    await loadThenFailARefresh();

    let answer: (
      value: Awaited<ReturnType<typeof fetchUsgsRegionEvents>>,
    ) => void = () => {};
    mockedUsgs.mockImplementation(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    mockedEmsc.mockResolvedValue({ events: [], skippedCount: 0, fetchedAt: Date.now() });
    mockedGeofon.mockResolvedValue({
      events: [],
      skippedCount: 0,
      fetchedAt: Date.now(),
    });
    const client = startApp();
    const { result, unmount } = await renderHook(() => useRegionEvents(), {
      wrapper: persistedWrapper(client),
    });

    await waitFor(() => expect(result.current.isRefreshing).toBe(true));
    expect(result.current.events.map((item) => item.id)).toEqual(["us7000abcd"]);
    expect(result.current.isOfflineIsh).toBe(false);
    expect(result.current.isHardError).toBe(false);

    answer({ events: [event("us7000wxyz")], skippedCount: 0, fetchedAt: Date.now() });
    await waitFor(() =>
      expect(result.current.events.map((item) => item.id)).toEqual(["us7000wxyz"]),
    );
    expect(result.current.isOfflineIsh).toBe(false);

    await unmount();
    await closeApp(client);
  });
});
