import { QueryClient, QueryClientProvider, dehydrate } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import React from "react";

import { useEventById, useRegionEvents, useWorldEvents } from "../queries";
import { fetchUsgsEventById, fetchUsgsRegionEvents, fetchUsgsWorldEvents } from "../usgs";

/**
 * Regression coverage for the event-deeplink-hang bug
 * (docs/debug-log.md): a cold-start deep link to an event that isn't in
 * either cached feed (`app/event/[id].tsx`'s `shouldFetchById` gate) must
 * actually issue the byId fetch and resolve out of the loading state, both
 * with an empty persisted cache (fresh install) and with a warm one
 * (returning device). This mirrors `app/event/[id].tsx`'s own gating logic
 * rather than rendering the full screen, so it stays focused on the
 * data-layer contract the screen depends on.
 */
jest.mock("../usgs", () => ({
  fetchUsgsRegionEvents: jest.fn(),
  fetchUsgsWorldEvents: jest.fn(),
  fetchUsgsEventById: jest.fn(),
}));

const mockedRegion = fetchUsgsRegionEvents as jest.MockedFunction<typeof fetchUsgsRegionEvents>;
const mockedWorld = fetchUsgsWorldEvents as jest.MockedFunction<typeof fetchUsgsWorldEvents>;
const mockedById = fetchUsgsEventById as jest.MockedFunction<typeof fetchUsgsEventById>;

const DEEP_LINK_ID = "us2000bmcg";

function useEventDetailGating(id: string) {
  const region = useRegionEvents();
  const world = useWorldEvents();
  const cachedEvent =
    region.events.find((e) => e.id === id) ?? world.events.find((e) => e.id === id) ?? null;
  const shouldFetchById =
    !cachedEvent && Boolean(id) && !region.isInitialLoading && !world.isInitialLoading;
  const byId = useEventById(id, shouldFetchById);
  const event = cachedEvent ?? byId.event;
  const isLoading =
    !event && (region.isInitialLoading || world.isInitialLoading || byId.isLoading);
  return { isLoading, event, shouldFetchById };
}

describe("event detail cold-start deep-link gating", () => {
  beforeEach(() => {
    mockedRegion.mockReset();
    mockedWorld.mockReset();
    mockedById.mockReset();
    mockedRegion.mockResolvedValue({ events: [], skippedCount: 0, fetchedAt: Date.now() });
    mockedWorld.mockResolvedValue({ events: [], skippedCount: 0, fetchedAt: Date.now() });
  });

  it("fires the byId fetch and clears loading once region/world settle empty (plain QueryClient)", async () => {
    mockedById.mockResolvedValue(null);

    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    function wrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    }

    const { result, unmount } = await renderHook(() => useEventDetailGating(DEEP_LINK_ID), {
      wrapper,
    });

    await waitFor(() => expect(result.current.shouldFetchById).toBe(true));
    expect(mockedById).toHaveBeenCalledWith(DEEP_LINK_ID);
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    unmount();
    client.clear();
  });

  it("resolves out of loading with a fresh (empty) persisted cache — cold install", async () => {
    await AsyncStorage.clear();
    mockedById.mockResolvedValue(null);

    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const persister = createAsyncStoragePersister({
      storage: AsyncStorage,
      key: "test-cache-cold",
    });
    function wrapper({ children }: { children: ReactNode }) {
      return (
        <PersistQueryClientProvider client={client} persistOptions={{ persister }}>
          {children}
        </PersistQueryClientProvider>
      );
    }

    const { result, unmount } = await renderHook(() => useEventDetailGating(DEEP_LINK_ID), {
      wrapper,
    });

    await waitFor(() => expect(result.current.shouldFetchById).toBe(true));
    expect(mockedById).toHaveBeenCalledWith(DEEP_LINK_ID);
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    unmount();
    client.clear();
  });

  it("resolves out of loading with a warm persisted cache from a prior session", async () => {
    await AsyncStorage.clear();

    // Seed a prior "session": region/world already fetched and persisted,
    // neither containing DEEP_LINK_ID (a real historical event outside
    // both feed windows) — the exact repro condition.
    const seedClient = new QueryClient();
    const seedPersister = createAsyncStoragePersister({
      storage: AsyncStorage,
      key: "test-cache-warm",
    });
    seedClient.setQueryData(["events", "region"], {
      events: [],
      skippedCount: 0,
      fetchedAt: Date.now(),
    });
    seedClient.setQueryData(["events", "world"], {
      events: [],
      skippedCount: 0,
      fetchedAt: Date.now(),
    });
    await seedPersister.persistClient({
      timestamp: Date.now(),
      buster: "",
      clientState: dehydrate(seedClient),
    });
    seedClient.clear();

    mockedById.mockResolvedValue(null);

    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const persister = createAsyncStoragePersister({
      storage: AsyncStorage,
      key: "test-cache-warm",
    });
    function wrapper({ children }: { children: ReactNode }) {
      return (
        <PersistQueryClientProvider client={client} persistOptions={{ persister }}>
          {children}
        </PersistQueryClientProvider>
      );
    }

    const { result, unmount } = await renderHook(() => useEventDetailGating(DEEP_LINK_ID), {
      wrapper,
    });

    await waitFor(() => expect(result.current.shouldFetchById).toBe(true));
    expect(mockedById).toHaveBeenCalledWith(DEEP_LINK_ID);
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    unmount();
    client.clear();
  });
});
