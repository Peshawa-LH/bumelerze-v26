/**
 * Sign-out and the React Query cache (security audit APP-04, with the
 * offline-first rule): the previous person's answers leave memory AND the
 * device copy before the next guest session starts; public data (the
 * earthquake feed above all) stays, so the app still opens with no network.
 *
 * The device copy is written by the real async-storage persister (throttled
 * saves, one at a time) with the provider's own subscription running, as in
 * app/_layout.tsx.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { QueryClient, type QueryKey } from "@tanstack/react-query";
import {
  persistQueryClientSubscribe,
  type PersistedClient,
  type Persister,
} from "@tanstack/react-query-persist-client";

import { accountKeys } from "@/features/account/stats";
import { twoStepKeys } from "@/features/account/use-two-step";
import { activityKeys } from "@/features/activity/queries";
import { alertsKeys } from "@/features/alerts/queries";
import { homeKeys } from "@/features/building/queries";
import { communityKeys } from "@/features/community/queries";
import { eventHubKeys } from "@/features/eventhub/queries";
import { possibleEventsQueryKeys } from "@/features/events/possible";
import {
  createEventsPersister,
  eventsQueryKeys,
  PERSISTED_CACHE_BUSTER,
  saveEventsCacheNow,
} from "@/features/events/queries";
import { supabaseEventByBumelerzeIdQueryKey } from "@/features/events/supabase-event";
import { feltMapQueryKeys } from "@/features/feltmap/queries";
import { liveShakeMapQueryKeys } from "@/features/shakemap/live-queries";
import { socialKeys } from "@/features/social/queries";
import { keepLastGoodData, persistLastGoodData, shouldPersistQuery } from "../persist-filter";
import {
  __resetSessionQueryCacheForTests,
  clearPersonalQueries,
  isPublicQueryKey,
  registerSessionQueryCache,
  trackPersisterSaves,
} from "../session-query-cache";

/** A fresh storage key per test: a save still due from one test never lands
 * in the next. */
let KEY = "test.react-query-cache";
let keyCount = 0;

const PUBLIC_KEYS: QueryKey[] = [
  eventsQueryKeys.region,
  eventsQueryKeys.world,
  eventsQueryKeys.notableTail,
  ["events", "byId", "us7000abcd"],
  possibleEventsQueryKeys.all,
  supabaseEventByBumelerzeIdQueryKey("bml20260001"),
  ["event-uuid", "usgs", "us7000abcd"],
  feltMapQueryKeys.event("e1"),
  liveShakeMapQueryKeys.event("e1"),
  ["station-trace", "KESO"],
  ["station-probe", ["KESO", "MLSB"]],
  eventHubKeys.summary("e1"),
  socialKeys.feltTowns("e1"),
  socialKeys.timeline("e1"),
];

const PERSONAL_KEYS: QueryKey[] = [
  accountKeys.stats("u1"),
  accountKeys.roles("u1"),
  twoStepKeys.onDevice("u1"),
  activityKeys.list("u1"),
  alertsKeys.overview,
  alertsKeys.devices("u1"),
  homeKeys.mine("u1"),
  communityKeys.profile("shilan", "u1"),
  communityKeys.blocks("u1"),
  eventHubKeys.thread("e1", "u1"),
  eventHubKeys.permissions("u1"),
  eventHubKeys.roles("u1"),
  socialKeys.hubLikes("e1", "u1"),
  ["mutes", "u1"],
  ["safe", "audience", "u1"],
  ["admin", "people", "person", "u2"],
  ["authority", "overview"],
  // Not listed anywhere yet: removed by default.
  ["brand-new-feature", "u1"],
  ["eventhub"],
];

describe("isPublicQueryKey (allow-list)", () => {
  it.each(PUBLIC_KEYS.map((key) => [JSON.stringify(key), key]))("keeps %s", (_name, key) => {
    expect(isPublicQueryKey(key as QueryKey)).toBe(true);
  });

  it.each(PERSONAL_KEYS.map((key) => [JSON.stringify(key), key]))(
    "removes %s",
    (_name, key) => {
      expect(isPublicQueryKey(key as QueryKey)).toBe(false);
    },
  );
});

// ---------------------------------------------------------------------------

/** AsyncStorage, optionally with a slow first write (a save under way). */
function makeStorage(firstWriteDelayMs = 0) {
  let writes = 0;
  return {
    getItem: (key: string) => AsyncStorage.getItem(key),
    removeItem: jest.fn((key: string) => AsyncStorage.removeItem(key)),
    setItem: async (key: string, value: string) => {
      writes += 1;
      if (writes === 1 && firstWriteDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, firstWriteDelayMs));
      }
      await AsyncStorage.setItem(key, value);
    },
  };
}

function makeProvider(storage: ReturnType<typeof makeStorage>) {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  // As createEventsPersister, on this test's storage.
  const persister = trackPersisterSaves(
    persistLastGoodData(createAsyncStoragePersister({ storage, key: KEY }) as Persister),
  );
  const options = {
    buster: PERSISTED_CACHE_BUSTER,
    shouldDehydrateQuery: shouldPersistQuery,
    // As saveEventsCacheNow, on this test's storage.
    saveNow: (next: PersistedClient) =>
      storage.setItem(KEY, JSON.stringify(keepLastGoodData(next))),
  };
  // What PersistQueryClientProvider does: a (throttled) save on every change.
  const unsubscribe = persistQueryClientSubscribe({
    queryClient: client,
    persister,
    buster: options.buster,
    dehydrateOptions: { shouldDehydrateQuery: shouldPersistQuery },
  });
  return { client, persister, options, unsubscribe };
}

function seed(client: QueryClient) {
  for (const key of PUBLIC_KEYS) client.setQueryData(key, { public: JSON.stringify(key) });
  for (const key of PERSONAL_KEYS) client.setQueryData(key, { private: "Shilan" });
}

async function stored(): Promise<PersistedClient | null> {
  const raw = await AsyncStorage.getItem(KEY);
  return raw ? (JSON.parse(raw) as PersistedClient) : null;
}

function storedKeys(saved: PersistedClient | null): string[] {
  return (saved?.clientState.queries ?? []).map((query) => JSON.stringify(query.queryKey));
}

async function waitFor(check: () => Promise<boolean>, ms = 3000) {
  const end = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

beforeEach(async () => {
  __resetSessionQueryCacheForTests();
  keyCount += 1;
  KEY = `test.react-query-cache.${keyCount}`;
  await AsyncStorage.clear();
});

jest.setTimeout(15_000);

describe("clearPersonalQueries", () => {
  it("[APP-04] the device copy holds no personal query when it resolves; the public ones stay, in memory and on the device", async () => {
    const storage = makeStorage();
    const { client, persister, options, unsubscribe } = makeProvider(storage);
    seed(client);
    // The device copy as the person left it: public AND personal answers.
    await waitFor(async () => storedKeys(await stored()).length === PUBLIC_KEYS.length + PERSONAL_KEYS.length);
    registerSessionQueryCache(client, persister, options);

    await clearPersonalQueries();

    // Read straight away: this is what the next guest session starts with.
    const saved = await stored();
    const keys = storedKeys(saved);
    for (const key of PERSONAL_KEYS) expect(keys).not.toContain(JSON.stringify(key));
    for (const key of PUBLIC_KEYS) expect(keys).toContain(JSON.stringify(key));
    expect(saved?.buster).toBe(PERSISTED_CACHE_BUSTER);
    expect(JSON.stringify(saved)).not.toContain("Shilan");
    expect(storage.removeItem).not.toHaveBeenCalled();

    // Memory too.
    for (const key of PERSONAL_KEYS) expect(client.getQueryData(key)).toBeUndefined();
    expect(client.getQueryData(eventsQueryKeys.region)).toEqual({
      public: JSON.stringify(eventsQueryKeys.region),
    });

    // A later throttled save never brings them back.
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect(JSON.stringify(await stored())).not.toContain("Shilan");
    unsubscribe();
  });

  it("a save of the old cache already under way cannot land after the cleaned one", async () => {
    // The first write takes 300 ms: it starts with the personal data in it.
    const storage = makeStorage(300);
    const { client, persister, options, unsubscribe } = makeProvider(storage);
    seed(client);
    await new Promise((resolve) => setTimeout(resolve, 20)); // the slow save has started
    registerSessionQueryCache(client, persister, options);

    await clearPersonalQueries();

    expect(JSON.stringify(await stored())).not.toContain("Shilan");
    expect(storedKeys(await stored())).toContain(JSON.stringify(eventsQueryKeys.region));
    // The slow old save landed BEFORE the clean-up returned, not after.
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect(JSON.stringify(await stored())).not.toContain("Shilan");
    unsubscribe();
  });

  it("an answer a screen loads for the next guest meanwhile does not cost the public cache", async () => {
    const storage = makeStorage();
    const { client, persister, options, unsubscribe } = makeProvider(storage);
    seed(client);
    registerSessionQueryCache(client, persister, options);

    const clearing = clearPersonalQueries();
    // The session has ended: a mounted screen loads its guest answer.
    client.setQueryData(["mutes", "none"], []);
    await clearing;

    const keys = storedKeys(await stored());
    expect(keys).toContain(JSON.stringify(eventsQueryKeys.region));
    expect(keys).toContain(JSON.stringify(["mutes", "none"]));
    expect(JSON.stringify(await stored())).not.toContain("Shilan");
    expect(storage.removeItem).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("removes the device copy altogether when a clean save cannot be confirmed in time", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
    seed(client);
    const old: PersistedClient = {
      timestamp: 1,
      buster: PERSISTED_CACHE_BUSTER,
      clientState: { queries: [], mutations: [] },
    };
    const persister: Persister = {
      persistClient: jest.fn(), // never writes
      restoreClient: jest.fn(async () => old),
      removeClient: jest.fn(),
    };
    registerSessionQueryCache(client, persister, { buster: PERSISTED_CACHE_BUSTER });

    await clearPersonalQueries({ waitMs: 50, confirmMs: 100 });

    expect(persister.removeClient).toHaveBeenCalledTimes(1);
    expect(client.getQueryData(eventsQueryKeys.region)).toBeDefined();
  });

  it("does not depend on the persister's throttle: a stuck save still ends clean, with the public cache", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
    seed(client);
    const storage = makeStorage();
    const persister: Persister = {
      persistClient: jest.fn(), // a throttled save that never comes
      restoreClient: async () => (await stored()) ?? undefined,
      removeClient: jest.fn(),
    };
    registerSessionQueryCache(client, persister, {
      buster: PERSISTED_CACHE_BUSTER,
      shouldDehydrateQuery: shouldPersistQuery,
      saveNow: (next) => storage.setItem(KEY, JSON.stringify(keepLastGoodData(next))),
    });

    const started = Date.now();
    await clearPersonalQueries();

    expect(Date.now() - started).toBeLessThan(500);
    expect(persister.removeClient).not.toHaveBeenCalled();
    const keys = storedKeys(await stored());
    expect(keys).toContain(JSON.stringify(eventsQueryKeys.region));
    expect(JSON.stringify(await stored())).not.toContain("Shilan");
  });

  it("saveEventsCacheNow writes what the app's own persister restores", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
    client.setQueryData(eventsQueryKeys.region, [{ id: "us7000abcd" }]);
    const { dehydrate } = jest.requireActual<typeof import("@tanstack/react-query")>(
      "@tanstack/react-query",
    );
    await saveEventsCacheNow({
      timestamp: 5,
      buster: PERSISTED_CACHE_BUSTER,
      clientState: dehydrate(client),
    });
    const restored = await createEventsPersister().restoreClient();
    expect(restored?.buster).toBe(PERSISTED_CACHE_BUSTER);
    expect(restored?.clientState.queries[0]?.queryKey).toEqual(eventsQueryKeys.region);
    expect(restored?.clientState.queries[0]?.state.data).toEqual([{ id: "us7000abcd" }]);
  });

  it("does nothing before the root layout registered the cache", async () => {
    await expect(clearPersonalQueries()).resolves.toBeUndefined();
  });
});
