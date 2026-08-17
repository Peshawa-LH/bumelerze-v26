/**
 * Same per-test fresh-module pattern as
 * `onboarding/__tests__/store.test.ts` — see that file's doc comment for
 * why `require` (not a static import) is needed here.
 */

function loadStore(): typeof import("../preferences-store") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- must be required fresh after resetModules, inside each test
  return require("../preferences-store");
}

function loadAsyncStorage() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- must be required fresh after resetModules, inside each test
  return require("@react-native-async-storage/async-storage") as typeof import("@react-native-async-storage/async-storage").default;
}

async function waitForHydration(getHasHydrated: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50 && !getHasHydrated(); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

beforeEach(() => {
  jest.resetModules();
});

describe("useMapPreferencesStore", () => {
  it("defaults to the outdoor style and hydrates true when nothing is persisted yet", async () => {
    const { useMapPreferencesStore } = loadStore();
    await waitForHydration(() => useMapPreferencesStore.getState().hasHydrated);

    const state = useMapPreferencesStore.getState();
    expect(state.hasHydrated).toBe(true);
    expect(state.styleId).toBe("outdoor");
  });

  it("persists a style pick under its own storage key, independent of other prefs stores", async () => {
    const { useMapPreferencesStore } = loadStore();
    await waitForHydration(() => useMapPreferencesStore.getState().hasHydrated);

    useMapPreferencesStore.getState().setStyleId("dataviz");
    expect(useMapPreferencesStore.getState().styleId).toBe("dataviz");

    const AsyncStorage = loadAsyncStorage();
    const raw = await AsyncStorage.getItem("bumelerze.map-preferences");
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw as string).state.styleId).toBe("dataviz");
  });

  it("reloads a previously persisted style pick on the next app start", async () => {
    const AsyncStorage = loadAsyncStorage();
    await AsyncStorage.setItem(
      "bumelerze.map-preferences",
      JSON.stringify({ state: { styleId: "hybrid" }, version: 0 }),
    );

    const { useMapPreferencesStore } = loadStore();
    await waitForHydration(() => useMapPreferencesStore.getState().hasHydrated);

    expect(useMapPreferencesStore.getState().styleId).toBe("hybrid");
  });
});
