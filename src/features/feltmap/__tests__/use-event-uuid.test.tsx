/**
 * The registry id the felt map and the Event hub are keyed by. Found
 * 2026-10-21: a lookup that could not reach the registry answered "no id";
 * the query kept that for good (`staleTime: Infinity`) and the device cache
 * saved it, so one attempt on a bad connection turned the event's felt map
 * and hub off for days. A failed lookup now fails the query: a saved id is
 * kept and the registry is asked again later.
 *
 * Uses the app's own query client, persister and persist filter (as
 * app/_layout.tsx wires them) with the jest AsyncStorage mock; only the
 * Supabase registry call is mocked.
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

import {
  createEventsPersister,
  createEventsQueryClient,
  PERSISTED_CACHE_MAX_AGE_MS,
} from "@/features/events/queries";
import type { Event } from "@/features/events/types";
import { shouldPersistQuery } from "@/lib/persist-filter";

import { useEventUuidResult } from "../use-event-uuid";

/** The registry as the lookup asks it: a read of the event's source record
 * (`event_source_records`), and the registration RPC for an event it does
 * not know yet. */
const mockRegistryRead = jest.fn();
const mockRpc = jest.fn();
const mockRegistryQuery = {
  select: () => mockRegistryQuery,
  eq: () => mockRegistryQuery,
  maybeSingle: () => ({ retry: () => mockRegistryRead() }),
};

jest.mock("@/lib/supabase", () => ({
  ...jest.requireActual("@/lib/supabase"),
  getSupabaseClient: () => ({ rpc: mockRpc, from: () => mockRegistryQuery }),
}));

/** The key `createEventsPersister` saves under (events/queries.ts). */
const STORAGE_KEY = "bumelerze.react-query-cache";
const BUSTER = "events-v1";
const REGISTRY_ID = "11111111-1111-4111-8111-111111111111";

/** Each test uses its own event: the lookup remembers found ids for the
 * whole session (`live-transport.ts`). */
function event(providerId: string): Event {
  return {
    id: providerId,
    bumelerzeId: null,
    originTime: Date.UTC(2026, 9, 20, 8, 0, 0),
    lat: 35.56,
    lon: 45.43,
    depthKm: 10,
    magnitude: { value: 4.4, type: "mb" },
    placeName: "Sulaymaniyah, Iraq",
    provenance: {
      provider: "usgs",
      providerId,
      fetchedAt: Date.now(),
      providerUpdatedAt: Date.now(),
    },
    sig: 300,
    isRegional: true,
    url: "",
  };
}

/** What supabase-js answers when the request never reaches the server. */
function registryUnreachable(): void {
  const offline = { data: null, error: { message: "TypeError: Network request failed" } };
  mockRegistryRead.mockResolvedValue(offline);
  mockRpc.mockResolvedValue(offline);
}

/** The registry knows the event: the read finds its id. */
function registryAnswers(id: string): void {
  mockRegistryRead.mockResolvedValue({ data: { event_id: id }, error: null });
  mockRpc.mockResolvedValue({ data: id, error: null });
}

const startedClients: QueryClient[] = [];

/** One app start: the app's own client, retrying without a pause. */
function startApp(): QueryClient {
  const client = createEventsQueryClient();
  client.setDefaultOptions({
    queries: { ...client.getDefaultOptions().queries, retryDelay: 0 },
  });
  startedClients.push(client);
  return client;
}

async function closeApp(client: QueryClient): Promise<void> {
  await client.cancelQueries();
  client.clear();
}

/** The provider app/_layout.tsx renders, with the same persist options. */
function persistedWrapper(client: QueryClient) {
  const persistOptions = {
    persister: createEventsPersister(),
    maxAge: PERSISTED_CACHE_MAX_AGE_MS,
    dehydrateOptions: { shouldDehydrateQuery: shouldPersistQuery },
    buster: BUSTER,
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

/** Waits for the save made at the latest change of the lookup (saves are
 * throttled to one a second). */
async function waitForSaveOf(client: QueryClient): Promise<void> {
  const state = client.getQueryCache().findAll({ queryKey: ["event-uuid"] })[0]?.state;
  const changedAt = Math.max(state?.dataUpdatedAt ?? 0, state?.errorUpdatedAt ?? 0);
  expect(changedAt).toBeGreaterThan(0);
  await waitFor(
    () => expect(lastSavedCopy()?.timestamp ?? 0).toBeGreaterThanOrEqual(changedAt),
    { timeout: 3000 },
  );
}

/** A device copy holding one lookup, as an app start would have saved it. */
async function seedSavedLookup(
  providerId: string,
  data: string | null,
  savedAgoMs: number,
): Promise<void> {
  const savedAt = Date.now() - savedAgoMs;
  const saved: PersistedClient = {
    timestamp: Date.now(),
    buster: BUSTER,
    clientState: {
      mutations: [],
      queries: [
        {
          queryKey: ["event-uuid", "usgs", providerId],
          queryHash: JSON.stringify(["event-uuid", "usgs", providerId]),
          dehydratedAt: savedAt,
          state: {
            data,
            dataUpdateCount: 1,
            dataUpdatedAt: savedAt,
            error: null,
            errorUpdateCount: 0,
            errorUpdatedAt: 0,
            fetchFailureCount: 0,
            fetchFailureReason: null,
            fetchMeta: null,
            isInvalidated: false,
            status: "success",
            fetchStatus: "idle",
          },
        },
      ],
    },
  };
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
}

beforeEach(async () => {
  await AsyncStorage.clear();
  onlineManager.setOnline(true);
  mockRegistryRead.mockReset();
  mockRpc.mockReset();
});

afterEach(async () => {
  for (const client of startedClients.splice(0)) {
    await closeApp(client);
  }
  onlineManager.setOnline(true);
});

describe("useEventUuidResult after a failed lookup", () => {
  it("asks the registry again on the next visit instead of keeping 'no id'", async () => {
    const quake = event("us_failed_then_found");
    const client = startApp();
    registryUnreachable();

    const first = await renderHook(() => useEventUuidResult(quake), {
      wrapper: persistedWrapper(client),
    });
    await waitFor(() => expect(first.result.current.isPending).toBe(false));
    expect(first.result.current.uuid).toBeNull();
    await first.unmount();

    registryAnswers(REGISTRY_ID);
    const second = await renderHook(() => useEventUuidResult(quake), {
      wrapper: persistedWrapper(client),
    });
    await waitFor(() => expect(second.result.current.uuid).toBe(REGISTRY_ID));
    await second.unmount();
  });

  it("never saves a failed lookup on the device, so the next start asks again", async () => {
    const quake = event("us_failed_before_restart");
    const firstStart = startApp();
    registryUnreachable();
    const first = await renderHook(() => useEventUuidResult(quake), {
      wrapper: persistedWrapper(firstStart),
    });
    await waitFor(() => expect(first.result.current.isPending).toBe(false));
    await waitForSaveOf(firstStart);
    expect(JSON.stringify(lastSavedCopy())).not.toContain("us_failed_before_restart");
    await first.unmount();
    await closeApp(firstStart);

    registryAnswers(REGISTRY_ID);
    const secondStart = startApp();
    const second = await renderHook(() => useEventUuidResult(quake), {
      wrapper: persistedWrapper(secondStart),
    });
    await waitFor(() => expect(second.result.current.uuid).toBe(REGISTRY_ID));
    expect(mockRegistryRead).toHaveBeenCalled();
    await second.unmount();
  });

  it("asks again for a 'no id' an earlier version saved after a failed lookup", async () => {
    const quake = event("us_saved_no_id");
    await seedSavedLookup("us_saved_no_id", null, 24 * 60 * 60 * 1000);
    registryAnswers(REGISTRY_ID);

    const client = startApp();
    const { result, unmount } = await renderHook(() => useEventUuidResult(quake), {
      wrapper: persistedWrapper(client),
    });

    await waitFor(() => expect(result.current.uuid).toBe(REGISTRY_ID));
    await unmount();
  });

  it("keeps a saved id, in memory and on the device, when a later lookup fails", async () => {
    const quake = event("us_saved_id");
    await seedSavedLookup("us_saved_id", REGISTRY_ID, 60 * 60 * 1000);
    registryUnreachable();

    const client = startApp();
    const { result, unmount } = await renderHook(() => useEventUuidResult(quake), {
      wrapper: persistedWrapper(client),
    });
    await waitFor(() => expect(result.current.uuid).toBe(REGISTRY_ID));
    // A found id is never looked up again by itself; ask anyway.
    expect(mockRegistryRead).not.toHaveBeenCalled();
    await client.invalidateQueries({ queryKey: ["event-uuid"] });
    expect(mockRegistryRead).toHaveBeenCalled();

    expect(client.getQueryState(["event-uuid", "usgs", "us_saved_id"])).toEqual(
      expect.objectContaining({ status: "error", data: REGISTRY_ID }),
    );
    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(result.current.uuid).toBe(REGISTRY_ID);
    await waitForSaveOf(client);
    const saved = lastSavedCopy()?.clientState.queries.find(
      (query) => query.queryKey[2] === "us_saved_id",
    );
    expect(saved?.state).toEqual(
      expect.objectContaining({ status: "success", data: REGISTRY_ID }),
    );
    await unmount();
  });
});
