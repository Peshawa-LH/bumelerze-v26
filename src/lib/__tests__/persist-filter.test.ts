import { QueryClient, dehydrate } from "@tanstack/react-query";
import type { PersistedClient, Persister } from "@tanstack/react-query-persist-client";

import {
  keepLastGoodData,
  persistLastGoodData,
  shouldPersistQuery,
} from "../persist-filter";

const REGION = ["events", "region"];

function failing(): Promise<never> {
  return Promise.reject(new TypeError("Network request failed"));
}

/** A client whose region feed loaded once, then failed to refresh. */
async function feedThatFailedARefresh(): Promise<{
  client: QueryClient;
  loadedAt: number;
}> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await client.prefetchQuery({ queryKey: REGION, queryFn: async () => ["saved"] });
  const loadedAt = client.getQueryState(REGION)?.dataUpdatedAt ?? 0;
  await client.prefetchQuery({ queryKey: REGION, queryFn: failing });
  expect(client.getQueryState(REGION)?.status).toBe("error");
  return { client, loadedAt };
}

function asPersisted(client: QueryClient): PersistedClient {
  return {
    timestamp: Date.now(),
    buster: "events-v1",
    clientState: dehydrate(client, { shouldDehydrateQuery: shouldPersistQuery }),
  };
}

describe("shouldPersistQuery", () => {
  it("persists ordinary successful queries but never ones marked persist:false", async () => {
    const client = new QueryClient();
    await client.prefetchQuery({
      queryKey: ["events", "region"],
      queryFn: async () => [1],
    });
    await client.prefetchQuery({
      queryKey: ["home", "mine", "u1"],
      queryFn: async () => ({ lat: 36.19, lon: 44.01, joinKey: "ABCD2345" }),
      meta: { persist: false },
    });
    const state = dehydrate(client, { shouldDehydrateQuery: shouldPersistQuery });
    const keys = state.queries.map((query) => query.queryKey[0]);
    expect(keys).toEqual(["events"]);
    expect(JSON.stringify(state)).not.toContain("ABCD2345");
    client.clear();
  });

  // A failed refresh used to drop the feed from the next save: reopened
  // offline, Home had nothing to show (2026-10-21).
  it("keeps a query whose latest refresh failed, with the data of its last success", async () => {
    const { client } = await feedThatFailedARefresh();

    const state = dehydrate(client, { shouldDehydrateQuery: shouldPersistQuery });

    expect(state.queries.map((query) => query.queryKey)).toEqual([REGION]);
    expect(state.queries[0]?.state.data).toEqual(["saved"]);
    client.clear();
  });

  it("never persists a failed query without data, nor a failed private one", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await client.prefetchQuery({ queryKey: ["events", "byId", "x"], queryFn: failing });
    await client.prefetchQuery({
      queryKey: ["home", "mine", "u1"],
      queryFn: async () => ({ joinKey: "ABCD2345" }),
      meta: { persist: false },
    });
    await client.prefetchQuery({
      queryKey: ["home", "mine", "u1"],
      queryFn: failing,
      meta: { persist: false },
    });

    const state = dehydrate(client, { shouldDehydrateQuery: shouldPersistQuery });

    expect(state.queries).toEqual([]);
    client.clear();
  });
});

describe("keepLastGoodData", () => {
  it("writes a failed refresh as its last success: data, time of that success, no error", async () => {
    const { client, loadedAt } = await feedThatFailedARefresh();

    const saved = keepLastGoodData(asPersisted(client));

    const state = saved.clientState.queries[0]?.state;
    expect(state).toEqual(
      expect.objectContaining({
        status: "success",
        data: ["saved"],
        dataUpdatedAt: loadedAt,
        error: null,
        fetchFailureCount: 0,
        fetchFailureReason: null,
      }),
    );
    client.clear();
  });

  it("returns the same copy when no query failed", async () => {
    const client = new QueryClient();
    await client.prefetchQuery({ queryKey: REGION, queryFn: async () => ["fresh"] });
    const persisted = asPersisted(client);

    expect(keepLastGoodData(persisted)).toBe(persisted);
    client.clear();
  });
});

describe("persistLastGoodData", () => {
  it("writes through keepLastGoodData and passes reads and removals on unchanged", async () => {
    const { client } = await feedThatFailedARefresh();
    const restored: PersistedClient = asPersisted(client);
    const inner: Persister = {
      persistClient: jest.fn(),
      restoreClient: jest.fn(() => restored),
      removeClient: jest.fn(),
    };
    const persister = persistLastGoodData(inner);

    await persister.persistClient(asPersisted(client));
    const written = jest.mocked(inner.persistClient).mock.calls[0]?.[0];
    expect(written?.clientState.queries[0]?.state.status).toBe("success");

    expect(await persister.restoreClient()).toBe(restored);
    await persister.removeClient();
    expect(inner.removeClient).toHaveBeenCalledTimes(1);
    client.clear();
  });
});
