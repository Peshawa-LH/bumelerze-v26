/**
 * Same per-test fresh-module pattern as
 * `features/map/__tests__/preferences-store.test.ts` — see that file's doc
 * comment for why `require` (not a static import) is needed here.
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

describe("useThemePreferencesStore", () => {
  it("defaults to 'auto' and hydrates true when nothing is persisted yet", async () => {
    const { useThemePreferencesStore } = loadStore();
    await waitForHydration(() => useThemePreferencesStore.getState().hasHydrated);

    const state = useThemePreferencesStore.getState();
    expect(state.hasHydrated).toBe(true);
    expect(state.preference).toBe("auto");
  });

  it("persists a preference change under its own storage key, independent of other prefs stores", async () => {
    const { useThemePreferencesStore } = loadStore();
    await waitForHydration(() => useThemePreferencesStore.getState().hasHydrated);

    useThemePreferencesStore.getState().setPreference("dark");
    expect(useThemePreferencesStore.getState().preference).toBe("dark");

    const AsyncStorage = loadAsyncStorage();
    const raw = await AsyncStorage.getItem("bumelerze.theme-preferences");
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw as string).state.preference).toBe("dark");
  });

  it("reloads a previously persisted preference on the next app start", async () => {
    const AsyncStorage = loadAsyncStorage();
    await AsyncStorage.setItem(
      "bumelerze.theme-preferences",
      JSON.stringify({ state: { preference: "light" }, version: 0 }),
    );

    const { useThemePreferencesStore } = loadStore();
    await waitForHydration(() => useThemePreferencesStore.getState().hasHydrated);

    expect(useThemePreferencesStore.getState().preference).toBe("light");
  });
});
