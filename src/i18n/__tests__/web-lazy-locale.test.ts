/**
 * The web build carries English only and downloads the language in use
 * (`locale-resources.web.ts`). These tests run `../index` with that web
 * loader and a persisted Sorani choice, the way a returning Sorani visitor
 * opens the web app: the Sorani file is in before the first screen, i18next
 * reports right-to-left (`i18n.dir()`, which many layouts read), and the
 * languages not in use are not loaded.
 */
jest.mock("../locale-resources", () => jest.requireActual("../locale-resources.web"));

type GlobalWithDom = typeof globalThis & { localStorage?: Storage };

function storageWith(locale: string): Storage {
  const store = new Map<string, string>([["bumelerze.language", locale]]);
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: () => null,
    get length() {
      return store.size;
    },
  } as Storage;
}

function loadWeb(locale: string): typeof import("../index") {
  jest.resetModules();
  (globalThis as GlobalWithDom).localStorage = storageWith(locale);
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- fresh require after resetModules
  const { Platform } = require("react-native") as typeof import("react-native");
  Platform.OS = "web";
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- fresh require after resetModules
  return require("../index") as typeof import("../index");
}

afterEach(() => {
  delete (globalThis as GlobalWithDom).localStorage;
  jest.resetModules();
});

describe("web: only the language in use is loaded", () => {
  it("Sorani: loaded before the first screen, right-to-left, Arabic and Kurmanji not loaded", async () => {
    const module = loadWeb("ckb");
    const i18n = module.default;
    expect(i18n.hasResourceBundle("ckb", "translation")).toBe(false);
    expect(module.isInitialLocaleReady()).toBe(false);

    await module.initialLocaleReady;

    expect(module.isInitialLocaleReady()).toBe(true);
    expect(i18n.hasResourceBundle("ckb", "translation")).toBe(true);
    expect(i18n.dir()).toBe("rtl");
    expect(i18n.t("nav.back")).toBe("گەڕانەوە");
    expect(i18n.hasResourceBundle("ar", "translation")).toBe(false);
    expect(i18n.hasResourceBundle("kmr", "translation")).toBe(false);
  });

  it("English: ready at once, nothing else loaded", async () => {
    const module = loadWeb("en");
    await module.initialLocaleReady;
    expect(module.default.dir()).toBe("ltr");
    expect(module.default.hasResourceBundle("ckb", "translation")).toBe(false);
  });

  it("switching language loads that file first", async () => {
    const module = loadWeb("en");
    await module.initialLocaleReady;
    await module.changeLocale("kmr");
    expect(module.default.hasResourceBundle("kmr", "translation")).toBe(true);
    expect(module.default.t("nav.back")).toBe("Vegere");
  });
});
