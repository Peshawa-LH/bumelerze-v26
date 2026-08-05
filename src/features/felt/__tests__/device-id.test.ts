/**
 * device-id stability (D8 identity model; wave brief scope item 6:
 * "device-id stability"). Same fresh-require-per-test pattern as
 * `features/onboarding/__tests__/store.test.ts` — `jest.resetModules()`
 * clears BOTH the module cache and the AsyncStorage jest mock's in-memory
 * backing store (it's a plain object on the mock module itself), so a
 * "survives restart" assertion is only meaningful if the mocked UUID
 * generator keeps counting across that reset too — otherwise a broken
 * "always regenerate" implementation could coincidentally produce the same
 * id by luck. The counter below lives on `globalThis`, which `resetModules`
 * does NOT clear, specifically to make that failure mode visible.
 */

jest.mock("expo-crypto", () => ({
  randomUUID: () => {
    const g = globalThis as { __feltTestUuidCounter?: number };
    g.__feltTestUuidCounter = (g.__feltTestUuidCounter ?? 0) + 1;
    return `test-uuid-${g.__feltTestUuidCounter}`;
  },
}));

function loadDeviceId(): typeof import("../device-id") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- must be required fresh after resetModules, inside each test
  return require("../device-id");
}

function loadAsyncStorage() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- see loadDeviceId
  return require("@react-native-async-storage/async-storage") as typeof import("@react-native-async-storage/async-storage").default;
}

beforeEach(() => {
  jest.resetModules();
});

describe("getDeviceId", () => {
  it("generates a device id and persists it to AsyncStorage on first call", async () => {
    const { getDeviceId } = loadDeviceId();
    const id = await getDeviceId();

    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);

    const AsyncStorage = loadAsyncStorage();
    const stored = await AsyncStorage.getItem("bumelerze.device-id");
    expect(stored).toBe(id);
  });

  it("returns the exact same id for concurrent/repeated calls within one session", async () => {
    const { getDeviceId } = loadDeviceId();
    const [first, second, third] = await Promise.all([
      getDeviceId(),
      getDeviceId(),
      getDeviceId(),
    ]);

    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  it("re-reads the SAME id after a simulated app restart, never regenerating it", async () => {
    const AsyncStorage = loadAsyncStorage();
    await AsyncStorage.setItem("bumelerze.device-id", "already-installed-device-id");

    const { getDeviceId } = loadDeviceId();
    const id = await getDeviceId();

    // Proves the persisted value won, not a freshly-minted "test-uuid-N".
    expect(id).toBe("already-installed-device-id");
  });

  it("generates a NEW, different id per fresh install (no persisted value yet)", async () => {
    const session1 = loadDeviceId();
    const id1 = await session1.getDeviceId();

    jest.resetModules();

    const session2 = loadDeviceId();
    const id2 = await session2.getDeviceId();

    // Two independent "installs" (nothing seeded into AsyncStorage between
    // them) must not collide.
    expect(id2).not.toBe(id1);
  });

  it("__resetDeviceIdCacheForTests forces the next call to re-read AsyncStorage", async () => {
    const { getDeviceId, __resetDeviceIdCacheForTests } = loadDeviceId();
    const AsyncStorage = loadAsyncStorage();

    const first = await getDeviceId();
    await AsyncStorage.setItem("bumelerze.device-id", "manually-overwritten-id");

    // Without the reset, the in-memory cache would still win — this proves
    // the escape hatch actually clears it.
    __resetDeviceIdCacheForTests();
    const second = await getDeviceId();

    expect(first).not.toBe("manually-overwritten-id");
    expect(second).toBe("manually-overwritten-id");
  });
});
