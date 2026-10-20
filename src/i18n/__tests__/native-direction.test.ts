/**
 * iOS/Android layout direction follows the APP language, not the phone's.
 *
 * React Native keeps two native flags (`allowRTL`, `forceRTL`; iOS user
 * defaults, Android shared preferences) and reads them once, when the JS
 * starts. The bugs these tests pin down:
 *
 * - an unconditional `allowRTL(true)` on every start let a Sorani or Arabic
 *   PHONE turn the layout right to left again on the next launch after the
 *   user picked English or Kurmanji in the app;
 * - a first launch on a Sorani phone showed Sorani text in a left-to-right
 *   layout, because nothing compared the detected language with the
 *   direction when no language had been picked yet;
 * - a direction restart that does not stick (a native flag reset before the
 *   JS starts) must never become a restart loop.
 *
 * Each test loads `../index` fresh after `jest.resetModules()`, with spies on
 * the SAME `react-native` instance the fresh module will import.
 */

const LANGUAGE_STORAGE_KEY = "bumelerze.language";

type I18nModule = typeof import("../index");
type ReactNativeModule = typeof import("react-native");
type AsyncStorageModule = {
  setItem: (key: string, value: string) => Promise<void>;
  getItem: (key: string) => Promise<string | null>;
};

interface Loaded {
  mod: I18nModule;
  allowRTL: jest.SpyInstance;
  forceRTL: jest.SpyInstance;
  rn: ReactNativeModule;
}

function freshReactNative(): ReactNativeModule {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- fresh require after resetModules
  return require("react-native") as ReactNativeModule;
}

function freshAsyncStorage(): AsyncStorageModule {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- fresh require after resetModules
  return require("@react-native-async-storage/async-storage") as AsyncStorageModule;
}

/** Loads `../index` as a native boot: `deviceLanguage` is what
 * expo-localization reports, `startsRTL` what React Native's flag said when
 * the JS started. */
function loadNative(deviceLanguage: string, startsRTL: boolean): Loaded {
  jest.doMock("expo-localization", () => ({
    getLocales: () => [{ languageCode: deviceLanguage, languageTag: deviceLanguage }],
  }));
  const rn = freshReactNative();
  expect(rn.Platform.OS).not.toBe("web");
  rn.I18nManager.isRTL = startsRTL;
  const allowRTL = jest.spyOn(rn.I18nManager, "allowRTL").mockImplementation(() => {});
  const forceRTL = jest.spyOn(rn.I18nManager, "forceRTL").mockImplementation(() => {});
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- fresh require after resetModules
  const mod = require("../index") as I18nModule;
  return { mod, allowRTL, forceRTL, rn };
}

beforeEach(() => {
  jest.resetModules();
});

afterEach(() => {
  jest.dontMock("expo-localization");
  jest.restoreAllMocks();
});

describe("native start-up", () => {
  it("[regression] does not call allowRTL(true) on every start (it would undo English picked on a Sorani phone)", () => {
    const { allowRTL } = loadNative("en", false);
    expect(allowRTL).not.toHaveBeenCalled();
  });

  it("still allows RTL at start-up on the web (unchanged)", () => {
    const rn = freshReactNative();
    rn.Platform.OS = "web";
    const allowRTL = jest.spyOn(rn.I18nManager, "allowRTL").mockImplementation(() => {});
    jest.spyOn(rn.I18nManager, "forceRTL").mockImplementation(() => {});
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- fresh require after resetModules
    require("../index");
    expect(allowRTL).toHaveBeenCalledWith(true);
  });
});

describe("changeLocale on iOS/Android", () => {
  it("pins both flags on when switching to Sorani, and asks for a restart", async () => {
    const { mod, allowRTL, forceRTL } = loadNative("en", false);

    const result = await mod.changeLocale("ckb");

    expect(result.requiresRestart).toBe(true);
    expect(allowRTL).toHaveBeenLastCalledWith(true);
    expect(forceRTL).toHaveBeenLastCalledWith(true);
  });

  it("[regression] pins both flags OFF when switching to English from a right-to-left session", async () => {
    const { mod, allowRTL, forceRTL } = loadNative("ckb", true);

    const result = await mod.changeLocale("en");

    expect(result.requiresRestart).toBe(true);
    // allowRTL(false) is what keeps a Sorani phone from turning the layout
    // right to left again on a later launch.
    expect(allowRTL).toHaveBeenLastCalledWith(false);
    expect(forceRTL).toHaveBeenLastCalledWith(false);
  });

  it("pins the flags without a restart when the direction stays (en -> kmr)", async () => {
    const { mod, allowRTL, forceRTL } = loadNative("en", false);

    const result = await mod.changeLocale("kmr");

    expect(result.requiresRestart).toBe(false);
    expect(allowRTL).toHaveBeenLastCalledWith(false);
    expect(forceRTL).toHaveBeenLastCalledWith(false);
  });
});

describe("applyPersistedLocaleOnLaunch on iOS/Android", () => {
  it("does nothing on an English phone with no language picked", async () => {
    const { mod, allowRTL, forceRTL } = loadNative("en", false);

    const result = await mod.applyPersistedLocaleOnLaunch();

    expect(result.requiresRestart).toBe(false);
    expect(allowRTL).not.toHaveBeenCalled();
    expect(forceRTL).not.toHaveBeenCalled();
  });

  it("does nothing on a Sorani phone that already starts right to left", async () => {
    const { mod, forceRTL } = loadNative("ckb", true);

    const result = await mod.applyPersistedLocaleOnLaunch();

    expect(result.requiresRestart).toBe(false);
    expect(forceRTL).not.toHaveBeenCalled();
  });

  it("[regression] restarts once into right to left on a Sorani phone that started left to right", async () => {
    const { mod, allowRTL, forceRTL } = loadNative("ckb", false);

    const result = await mod.applyPersistedLocaleOnLaunch();

    expect(mod.default.language).toBe("ckb");
    expect(result.requiresRestart).toBe(true);
    expect(allowRTL).toHaveBeenLastCalledWith(true);
    expect(forceRTL).toHaveBeenLastCalledWith(true);
  });

  it("restarts into the picked language's direction when it differs from the phone's", async () => {
    await freshAsyncStorage().setItem(LANGUAGE_STORAGE_KEY, "en");
    const { mod, allowRTL, forceRTL } = loadNative("ar", true);

    const result = await mod.applyPersistedLocaleOnLaunch();

    expect(mod.default.language).toBe("en");
    expect(result.requiresRestart).toBe(true);
    expect(allowRTL).toHaveBeenLastCalledWith(false);
    expect(forceRTL).toHaveBeenLastCalledWith(false);
  });

  it("[regression] never restarts twice in a row when the direction did not stick (no loop)", async () => {
    const storage = freshAsyncStorage();
    const first = loadNative("ckb", false);
    expect((await first.mod.applyPersistedLocaleOnLaunch()).requiresRestart).toBe(true);

    // The "restarted" app comes back still left to right: same storage
    // (the mock keeps its data across this reload), fresh JS.
    const persisted = await storage.getItem("bumelerze.launchDirectionRestartAt");
    expect(persisted).not.toBeNull();
    jest.resetModules();
    await freshAsyncStorage().setItem("bumelerze.launchDirectionRestartAt", persisted ?? "");
    const second = loadNative("ckb", false);

    expect((await second.mod.applyPersistedLocaleOnLaunch()).requiresRestart).toBe(false);
  });

  it("allows a direction restart again after the guard window has passed", async () => {
    const longAgo = String(Date.now() - 10 * 60_000);
    await freshAsyncStorage().setItem("bumelerze.launchDirectionRestartAt", longAgo);
    const { mod } = loadNative("ckb", false);

    expect((await mod.applyPersistedLocaleOnLaunch()).requiresRestart).toBe(true);
  });
});
