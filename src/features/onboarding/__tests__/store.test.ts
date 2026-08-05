import type { PrefsState } from "../store";

/**
 * Each test gets a fresh module (and a fresh AsyncStorage mock instance,
 * since `jest.resetModules()` clears the whole require cache) via a
 * per-test `require("../store")` — this file never imports "../store"
 * statically, so every test's first require genuinely re-runs the module's
 * top-level `persist(...)` setup against whatever AsyncStorage state that
 * test seeded beforehand. (Plain `require`, not dynamic `import()` — this
 * project's Jest config runs CommonJS/babel-jest without
 * `--experimental-vm-modules`.)
 */

function loadStore(): typeof import("../store") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- must be required fresh after resetModules, inside each test
  return require("../store");
}

function loadAsyncStorage() {
  // The jest mock (jest.setup.js) exports the storage object directly (no
  // `.default`), unlike the real ES module — reach for it as CommonJS here.
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

describe("usePrefsStore hydration", () => {
  it("starts with onboarding incomplete and hasHydrated true once AsyncStorage resolves, when nothing is persisted yet", async () => {
    const { usePrefsStore } = loadStore();
    await waitForHydration(() => usePrefsStore.getState().hasHydrated);

    const state = usePrefsStore.getState();
    expect(state.hasHydrated).toBe(true);
    expect(state.onboardingCompleted).toBe(false);
    expect(state.onboardingStep).toBe("mission");
    expect(state.homeBase).toBeNull();
  });

  it("gates on hasHydrated before reading real persisted values (no-flicker requirement)", async () => {
    const AsyncStorage = loadAsyncStorage();
    await AsyncStorage.setItem(
      "bumelerze.prefs",
      JSON.stringify({
        state: {
          onboardingCompleted: true,
          onboardingStep: "done",
          homeBase: { townId: "erbil", lat: 36.19, lon: 44.01 },
        },
        version: 0,
      }),
    );

    const { usePrefsStore } = loadStore();
    await waitForHydration(() => usePrefsStore.getState().hasHydrated);

    const state = usePrefsStore.getState();
    expect(state.onboardingCompleted).toBe(true);
    expect(state.onboardingStep).toBe("done");
    expect(state.homeBase).toEqual({ townId: "erbil", lat: 36.19, lon: 44.01 });
  });
});

describe("usePrefsStore actions", () => {
  it("advances onboardingStep and persists the write to AsyncStorage", async () => {
    const AsyncStorage = loadAsyncStorage();
    const { usePrefsStore } = loadStore();
    await waitForHydration(() => usePrefsStore.getState().hasHydrated);

    usePrefsStore.getState().setOnboardingStep("location");
    expect(usePrefsStore.getState().onboardingStep).toBe("location");

    // The persist middleware writes asynchronously — poll until it lands.
    let raw: string | null = null;
    for (let attempt = 0; attempt < 50 && !raw?.includes('"location"'); attempt += 1) {
      raw = await AsyncStorage.getItem("bumelerze.prefs");
      if (!raw?.includes('"location"')) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
    expect(raw).toContain('"onboardingStep":"location"');
  });

  it("completeOnboarding sets both onboardingCompleted and onboardingStep", async () => {
    const { usePrefsStore } = loadStore();
    await waitForHydration(() => usePrefsStore.getState().hasHydrated);

    usePrefsStore.getState().completeOnboarding();

    expect(usePrefsStore.getState().onboardingCompleted).toBe(true);
    expect(usePrefsStore.getState().onboardingStep).toBe("done");
  });

  it("setHomeBase stores a real town, and null represents 'elsewhere'/skip", async () => {
    const { usePrefsStore } = loadStore();
    await waitForHydration(() => usePrefsStore.getState().hasHydrated);

    const town: PrefsState["homeBase"] = { townId: "duhok", lat: 36.87, lon: 42.99 };
    usePrefsStore.getState().setHomeBase(town);
    expect(usePrefsStore.getState().homeBase).toEqual(town);

    usePrefsStore.getState().setHomeBase(null);
    expect(usePrefsStore.getState().homeBase).toBeNull();
  });

  it("resetOnboarding (Settings' 'replay onboarding') clears completion and rewinds the step", async () => {
    const { usePrefsStore } = loadStore();
    await waitForHydration(() => usePrefsStore.getState().hasHydrated);

    usePrefsStore.getState().completeOnboarding();
    expect(usePrefsStore.getState().onboardingCompleted).toBe(true);

    usePrefsStore.getState().resetOnboarding();
    expect(usePrefsStore.getState().onboardingCompleted).toBe(false);
    expect(usePrefsStore.getState().onboardingStep).toBe("mission");
  });
});
