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

const ERBIL = { placeId: "erbil", lat: 36.19, lon: 44.01 };
const DUHOK = { placeId: "duhok", lat: 36.87, lon: 42.99 };

async function seed(state: Record<string, unknown>, version = 0): Promise<void> {
  const AsyncStorage = loadAsyncStorage();
  await AsyncStorage.setItem("bumelerze.prefs", JSON.stringify({ state, version }));
}

async function loadHydrated() {
  const { usePrefsStore } = loadStore();
  await waitForHydration(() => usePrefsStore.getState().hasHydrated);
  return usePrefsStore;
}

describe("usePrefsStore hydration", () => {
  it("starts with onboarding incomplete, no places and hasHydrated true when nothing is persisted yet", async () => {
    const usePrefsStore = await loadHydrated();

    const state = usePrefsStore.getState();
    expect(state.hasHydrated).toBe(true);
    expect(state.onboardingCompleted).toBe(false);
    expect(state.onboardingStep).toBe("mission");
    expect(state.referencePlace).toBeNull();
    expect(state.referenceCheckedAt).toBeNull();
    expect(state.anotherPlace).toBeNull();
    // Near-me alerts on at M3+ by default; "another place" is off.
    expect(state.nearMeTier).toBe("m3");
    expect(state.anotherPlaceTier).toBe("off");
  });

  it("keeps current-version values across hydration (no migration, tiers not re-derived)", async () => {
    await seed(
      {
        onboardingCompleted: true,
        onboardingStep: "done",
        referencePlace: ERBIL,
        referenceCheckedAt: 1_700_000_000_000,
        nearMeTier: "off",
        anotherPlace: DUHOK,
        anotherPlaceTier: "m5",
      },
      1,
    );
    const state = (await loadHydrated()).getState();

    expect(state.onboardingCompleted).toBe(true);
    expect(state.referencePlace).toEqual(ERBIL);
    expect(state.referenceCheckedAt).toBe(1_700_000_000_000);
    expect(state.nearMeTier).toBe("off");
    expect(state.anotherPlace).toEqual(DUHOK);
    expect(state.anotherPlaceTier).toBe("m5");
  });
});

describe("usePrefsStore actions", () => {
  it("advances onboardingStep and persists the write to AsyncStorage", async () => {
    const AsyncStorage = loadAsyncStorage();
    const usePrefsStore = await loadHydrated();

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
    expect(raw).toContain('"version":1');
  });

  it("completeOnboarding sets both onboardingCompleted and onboardingStep", async () => {
    const usePrefsStore = await loadHydrated();

    usePrefsStore.getState().completeOnboarding();

    expect(usePrefsStore.getState().onboardingCompleted).toBe(true);
    expect(usePrefsStore.getState().onboardingStep).toBe("done");
  });

  it("setNearMeTier and setAnotherPlaceTier update their own tier independently", async () => {
    const usePrefsStore = await loadHydrated();

    usePrefsStore.getState().setNearMeTier("m5");
    expect(usePrefsStore.getState().nearMeTier).toBe("m5");
    expect(usePrefsStore.getState().anotherPlaceTier).toBe("off");

    usePrefsStore.getState().setAnotherPlaceTier("all");
    expect(usePrefsStore.getState().anotherPlaceTier).toBe("all");
    expect(usePrefsStore.getState().nearMeTier).toBe("m5");
  });

  it("setAnotherPlace defaults the tier to 'all' for a first place, keeps a customised tier when swapping places, and resets to off on removal", async () => {
    const usePrefsStore = await loadHydrated();

    expect(usePrefsStore.getState().anotherPlaceTier).toBe("off");

    usePrefsStore.getState().setAnotherPlace(ERBIL);
    expect(usePrefsStore.getState().anotherPlace).toEqual(ERBIL);
    expect(usePrefsStore.getState().anotherPlaceTier).toBe("all");

    usePrefsStore.getState().setAnotherPlaceTier("m4");
    usePrefsStore.getState().setAnotherPlace(DUHOK);
    expect(usePrefsStore.getState().anotherPlaceTier).toBe("m4");

    usePrefsStore.getState().setAnotherPlace(null);
    expect(usePrefsStore.getState().anotherPlace).toBeNull();
    expect(usePrefsStore.getState().anotherPlaceTier).toBe("off");
  });

  it("an automatic reference update keeps the alert tiers, persists, and a check without change only moves the time", async () => {
    const AsyncStorage = loadAsyncStorage();
    const usePrefsStore = await loadHydrated();

    usePrefsStore
      .getState()
      .setReferencePlace(
        { placeId: "slemani", lat: 35.56, lon: 45.43 },
        1_700_000_000_000,
      );
    const state = usePrefsStore.getState();
    expect(state.referencePlace?.placeId).toBe("slemani");
    expect(state.referenceCheckedAt).toBe(1_700_000_000_000);
    expect(state.anotherPlace).toBeNull();
    expect(state.anotherPlaceTier).toBe("off");

    usePrefsStore.getState().markReferenceChecked(1_700_000_100_000);
    expect(usePrefsStore.getState().referencePlace?.placeId).toBe("slemani");
    expect(usePrefsStore.getState().referenceCheckedAt).toBe(1_700_000_100_000);

    let raw: string | null = null;
    for (let attempt = 0; attempt < 50 && !raw?.includes("1700000100000"); attempt += 1) {
      raw = await AsyncStorage.getItem("bumelerze.prefs");
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(raw).toContain('"referencePlace":{"placeId":"slemani"');
    expect(raw).toContain('"referenceCheckedAt":1700000100000');
  });

  it("resetOnboarding (Settings' 'replay onboarding') clears completion and rewinds the step, keeping places", async () => {
    const usePrefsStore = await loadHydrated();

    usePrefsStore.getState().setAnotherPlace(DUHOK);
    usePrefsStore.getState().completeOnboarding();
    expect(usePrefsStore.getState().onboardingCompleted).toBe(true);

    usePrefsStore.getState().resetOnboarding();
    expect(usePrefsStore.getState().onboardingCompleted).toBe(false);
    expect(usePrefsStore.getState().onboardingStep).toBe("mission");
    expect(usePrefsStore.getState().anotherPlace).toEqual(DUHOK);
  });
});

describe("prefs migration from the HomeBase model (persist version 0 to 1)", () => {
  it("a HomeBase picked by hand becomes 'another place', with the tier they had", async () => {
    await seed({
      onboardingCompleted: true,
      onboardingStep: "done",
      homeBase: { townId: "duhok", lat: 36.87, lon: 42.99 },
      homeBaseSource: "manual",
      homeBaseAutoCheckedAt: null,
      nearMeTier: "m4",
      homeBaseTier: "m5",
    });
    const state = (await loadHydrated()).getState();

    expect(state.anotherPlace).toEqual(DUHOK);
    expect(state.anotherPlaceTier).toBe("m5");
    // Their town also stays as the silent reference until a location check.
    expect(state.referencePlace).toEqual(DUHOK);
    expect(state.referenceCheckedAt).toBeNull();
    // Everything else passes through untouched.
    expect(state.nearMeTier).toBe("m4");
    expect(state.onboardingCompleted).toBe(true);
    expect(state.onboardingStep).toBe("done");
  });

  it("an automatic HomeBase becomes just the background reference, with no extra place", async () => {
    await seed({
      onboardingCompleted: true,
      onboardingStep: "done",
      homeBase: { townId: "erbil", lat: 36.19, lon: 44.01 },
      homeBaseSource: "auto",
      homeBaseAutoCheckedAt: 1_700_000_000_000,
      nearMeTier: "m3",
      homeBaseTier: "all",
    });
    const state = (await loadHydrated()).getState();

    expect(state.referencePlace).toEqual(ERBIL);
    expect(state.referenceCheckedAt).toBe(1_700_000_000_000);
    expect(state.anotherPlace).toBeNull();
    expect(state.anotherPlaceTier).toBe("off");
  });

  it("'elsewhere' (a manual HomeBase of null) means no extra place and no reference", async () => {
    await seed({
      onboardingCompleted: true,
      onboardingStep: "done",
      homeBase: null,
      homeBaseSource: "manual",
      nearMeTier: "m3",
      homeBaseTier: "off",
    });
    const state = (await loadHydrated()).getState();

    expect(state.anotherPlace).toBeNull();
    expect(state.anotherPlaceTier).toBe("off");
    expect(state.referencePlace).toBeNull();
  });

  it("an install from before the source field: a saved town was their own choice, so it becomes 'another place' at tier 'all'", async () => {
    await seed({
      onboardingCompleted: true,
      onboardingStep: "done",
      homeBase: { townId: "erbil", lat: 36.19, lon: 44.01 },
      // No source, no tiers: a blob from before those fields existed.
    });
    const state = (await loadHydrated()).getState();

    expect(state.anotherPlace).toEqual(ERBIL);
    expect(state.anotherPlaceTier).toBe("all");
    expect(state.nearMeTier).toBe("m3");
  });

  it("an install with no HomeBase at all migrates to no places", async () => {
    await seed({ onboardingCompleted: false, onboardingStep: "language" });
    const state = (await loadHydrated()).getState();

    expect(state.referencePlace).toBeNull();
    expect(state.anotherPlace).toBeNull();
    expect(state.anotherPlaceTier).toBe("off");
    expect(state.onboardingStep).toBe("language");
  });

  it("drops the old keys from storage once the new version is written", async () => {
    const AsyncStorage = loadAsyncStorage();
    await seed({
      onboardingCompleted: true,
      onboardingStep: "done",
      homeBase: { townId: "duhok", lat: 36.87, lon: 42.99 },
      homeBaseSource: "manual",
      homeBaseTier: "all",
    });
    const usePrefsStore = await loadHydrated();
    usePrefsStore.getState().setNearMeTier("m5");

    let raw: string | null = null;
    for (let attempt = 0; attempt < 50 && !raw?.includes('"version":1'); attempt += 1) {
      raw = await AsyncStorage.getItem("bumelerze.prefs");
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(raw).toContain('"version":1');
    expect(raw).not.toContain("homeBase");
    expect(raw).toContain('"anotherPlace":{"placeId":"duhok"');
  });
});

describe("migratePrefs", () => {
  it("leaves a current-version blob alone", () => {
    const { migratePrefs, PREFS_VERSION } = loadStore();
    const blob = { anotherPlace: null, nearMeTier: "m3" };
    expect(migratePrefs(blob, PREFS_VERSION)).toBe(blob);
  });

  it("ignores a HomeBase whose coordinates are missing (the old 'elsewhere' sentinel)", () => {
    const { migratePrefs } = loadStore();
    const out = migratePrefs(
      {
        homeBase: { townId: "elsewhere", lat: null, lon: null },
        homeBaseSource: "manual",
        homeBaseTier: "all",
      },
      0,
    );
    expect(out.anotherPlace).toBeNull();
    expect(out.anotherPlaceTier).toBe("off");
    expect(out.referencePlace).toBeNull();
  });
});
