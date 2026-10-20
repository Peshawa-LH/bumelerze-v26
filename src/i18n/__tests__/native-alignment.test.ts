/**
 * Text alignment and the app's iOS language on iOS/Android.
 *
 * - iOS and Android swap `textAlign: "left"`/`"right"` while the native
 *   layout runs right to left, so a physical side has to be asked for
 *   through `physicalTextAlign`; under Sorani a bare "right" landed on the
 *   left (`directionStyle`, every call site).
 * - iOS aligns text without a `textAlign` by the app's iOS language
 *   (`AppleLanguages`), which has to follow the language chosen in the app.
 *
 * Each test loads `../index` fresh, like native-direction.test.ts.
 */

type I18nModule = typeof import("../index");
type ReactNativeModule = typeof import("react-native");

const LANGUAGE_STORAGE_KEY = "bumelerze.language";

function freshReactNative(): ReactNativeModule {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- fresh require after resetModules
  return require("react-native") as ReactNativeModule;
}

async function persistLanguage(locale: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- fresh require after resetModules
  const storage = require("@react-native-async-storage/async-storage") as {
    setItem: (key: string, value: string) => Promise<void>;
  };
  await storage.setItem(LANGUAGE_STORAGE_KEY, locale);
}

interface Loaded {
  mod: I18nModule;
  settingsSet: jest.Mock;
}

/** A native (iOS) boot with `settings` as the app's user defaults. */
function load({
  os = "ios",
  isRTL,
  deviceLanguage = "en",
  settings = {},
}: {
  os?: "ios" | "web";
  isRTL: boolean;
  deviceLanguage?: string;
  settings?: Record<string, unknown>;
}): Loaded {
  jest.doMock("expo-localization", () => ({
    getLocales: () => [{ languageCode: deviceLanguage, languageTag: deviceLanguage }],
  }));
  // The app's user defaults, behind React Native's own `Settings` (iOS).
  const settingsSet = jest.fn();
  jest.doMock("react-native/Libraries/Settings/NativeSettingsManager", () => ({
    __esModule: true,
    default: {
      getConstants: () => ({ settings: { ...settings } }),
      setValues: settingsSet,
      deleteValues: jest.fn(),
    },
  }));
  const rn = freshReactNative();
  rn.Platform.OS = os;
  rn.I18nManager.isRTL = isRTL;
  jest.spyOn(rn.I18nManager, "allowRTL").mockImplementation(() => {});
  jest.spyOn(rn.I18nManager, "forceRTL").mockImplementation(() => {});
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- fresh require after resetModules
  const mod = require("../index") as I18nModule;
  return { mod, settingsSet };
}

beforeEach(() => {
  jest.resetModules();
});

afterEach(() => {
  jest.dontMock("expo-localization");
  jest.dontMock("react-native/Libraries/Settings/NativeSettingsManager");
  jest.restoreAllMocks();
});

describe("physicalTextAlign", () => {
  it("[regression] asks iOS for the opposite side under a right-to-left layout", () => {
    const { mod } = load({ isRTL: true });
    expect(mod.physicalTextAlign("left")).toBe("right");
    expect(mod.physicalTextAlign("right")).toBe("left");
  });

  it("passes the side through under a left-to-right layout", () => {
    const { mod } = load({ isRTL: false });
    expect(mod.physicalTextAlign("left")).toBe("left");
    expect(mod.physicalTextAlign("right")).toBe("right");
  });

  it("never swaps on the web", () => {
    const { mod } = load({ os: "web", isRTL: true });
    expect(mod.physicalTextAlign("right")).toBe("right");
  });
});

describe("directionStyle", () => {
  it("[regression] puts Sorani at the reading start (right) on iOS: textAlign left under RTL", () => {
    const { mod } = load({ isRTL: true });
    expect(mod.directionStyle("ckb")).toEqual({
      writingDirection: "rtl",
      textAlign: "left",
    });
    expect(mod.directionStyle("ar")).toEqual({
      writingDirection: "rtl",
      textAlign: "left",
    });
  });

  it("an English or Kurmanji paragraph inside a right-to-left layout sits on the left", () => {
    const { mod } = load({ isRTL: true });
    expect(mod.directionStyle("en")).toEqual({
      writingDirection: "ltr",
      textAlign: "right",
    });
  });

  it("keeps the web unchanged: physical right for Sorani and Arabic", () => {
    const { mod } = load({ os: "web", isRTL: false });
    expect(mod.directionStyle("ckb")).toEqual({
      writingDirection: "rtl",
      textAlign: "right",
    });
    expect(mod.directionStyle("kmr")).toEqual({
      writingDirection: "ltr",
      textAlign: "left",
    });
  });
});

describe("ltrValueStyle (emails, usernames, ids)", () => {
  it("[regression] sits on the physical left under Sorani on iOS, as on the web", () => {
    expect(load({ isRTL: true }).mod.ltrValueStyle()).toEqual({
      writingDirection: "ltr",
      textAlign: "right",
    });
    jest.resetModules();
    expect(load({ os: "web", isRTL: false }).mod.ltrValueStyle()).toEqual({
      writingDirection: "ltr",
      textAlign: "left",
    });
  });
});

describe("the app's iOS language", () => {
  it("[regression] follows a language picked in the app", async () => {
    const { mod, settingsSet } = load({ isRTL: false, deviceLanguage: "en" });

    await mod.changeLocale("ckb");

    expect(settingsSet).toHaveBeenCalledWith({
      AppleLanguages: ["ckb"],
      "bumelerze.appleLanguage": "ckb",
    });
  });

  it("is left to the phone while no language was ever picked", async () => {
    const { mod, settingsSet } = load({
      isRTL: false,
      deviceLanguage: "en",
      settings: { AppleLanguages: ["en-US", "de-DE"] },
    });

    await mod.applyPersistedLocaleOnLaunch();

    expect(settingsSet).not.toHaveBeenCalled();
  });

  it("is repaired at launch when a picked language is not iOS's yet", async () => {
    await persistLanguage("ckb");
    const { mod, settingsSet } = load({
      isRTL: true,
      deviceLanguage: "ckb",
      settings: { AppleLanguages: ["en-US"] },
    });

    const result = await mod.applyPersistedLocaleOnLaunch();

    expect(result.requiresRestart).toBe(false);
    expect(settingsSet).toHaveBeenCalledWith({
      AppleLanguages: ["ckb"],
      "bumelerze.appleLanguage": "ckb",
    });
  });

  it("a language picked for the app in the iOS Settings app wins over the old pick", async () => {
    await persistLanguage("ckb");
    const { mod, settingsSet } = load({
      isRTL: true,
      deviceLanguage: "ar",
      // iOS Settings > Bumelerze > Language wrote "ar" after the app wrote "ckb".
      settings: { AppleLanguages: ["ar-IQ"], "bumelerze.appleLanguage": "ckb" },
    });

    const result = await mod.applyPersistedLocaleOnLaunch();

    expect(mod.default.language).toBe("ar");
    expect(result.requiresRestart).toBe(false);
    // Remembered as the app's own choice from now on.
    expect(await mod.getPersistedLocale()).toBe("ar");
    expect(settingsSet).toHaveBeenLastCalledWith({
      AppleLanguages: ["ar"],
      "bumelerze.appleLanguage": "ar",
    });
  });

  it('[decision 2026-10-20] a phone or app language "ku" is Kurmanji', async () => {
    await persistLanguage("ckb");
    const { mod } = load({
      isRTL: true,
      deviceLanguage: "ku",
      settings: { AppleLanguages: ["ku"], "bumelerze.appleLanguage": "ckb" },
    });

    const result = await mod.applyPersistedLocaleOnLaunch();

    expect(mod.default.language).toBe("kmr");
    expect(result.requiresRestart).toBe(true);
  });

  it('starts in Kurmanji on a phone set to "ku"', () => {
    const { mod } = load({ isRTL: false, deviceLanguage: "ku" });
    expect(mod.default.language).toBe("kmr");
  });

  it("never touches the web", async () => {
    const { mod, settingsSet } = load({ os: "web", isRTL: false });

    await mod.changeLocale("ckb");

    expect(settingsSet).not.toHaveBeenCalled();
  });
});
