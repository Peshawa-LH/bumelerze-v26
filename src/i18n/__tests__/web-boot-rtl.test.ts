/**
 * Regression coverage for the P0 web bug: switching to an RTL locale
 * (ckb/ar) on the web build put the app into an infinite reload loop.
 *
 * Root cause: `I18nManager.forceRTL` is in-memory only on
 * react-native-web — unlike native, it never survives a reload. Every web
 * boot re-ran `applyPersistedLocaleOnLaunch()`, which (before this fix)
 * always found `I18nManager.isRTL === false` for a persisted RTL locale,
 * asked for a restart, reloaded (`location.reload()` under
 * `Updates.reloadAsync()` on web), and immediately hit the same mismatch
 * again on the next boot — forever.
 *
 * The fix (see the module-load block in `../index.ts`) reads the persisted
 * locale synchronously off `window.localStorage` *before* `i18n.init`, on
 * web only, and applies forceRTL + the DOM `dir` attribute + the initial
 * i18next language right there, so by the time the launch effect runs
 * there's nothing left to reconcile.
 *
 * These tests drive the module fresh via `jest.resetModules()` under a
 * mocked `Platform.OS = "web"` (mirroring
 * `src/features/sensor/__tests__/sensor-screen-web.test.tsx`'s existing
 * convention) plus a stub `window.localStorage`/`document`, so the
 * module-load side effects run exactly as they would on a real web boot.
 * `react-native` itself is re-required after each `resetModules()` so the
 * `Platform.OS` mutation lands on the same module instance our freshly
 * required `../index` will import (mutating a stale, already-evicted
 * instance is a no-op).
 */

const LANGUAGE_STORAGE_KEY = "bumelerze.language";

/** Minimal, spec-shaped `Storage` stand-in — see the deep-import proof
 * below for why a raw in-memory map is a faithful stand-in for
 * `window.localStorage` here. */
function makeFakeLocalStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => (store.has(key) ? (store.get(key) ?? null) : null),
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => store.clear(),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
}

interface FakeDocumentElement {
  setAttribute: (name: string, value: string) => void;
  getAttribute: (name: string) => string | null;
}

function makeFakeDocumentElement(): FakeDocumentElement {
  const attrs = new Map<string, string>();
  return {
    setAttribute: (name: string, value: string) => {
      attrs.set(name, value);
    },
    getAttribute: (name: string) => attrs.get(name) ?? null,
  };
}

type GlobalWithDom = typeof globalThis & { localStorage?: Storage };

const globalWithDom = globalThis as GlobalWithDom;

/** The real global `document` is typed as the full DOM `Document`
 * interface, which a hand-rolled stub can't satisfy structurally — this
 * module keeps its own reference to the fake `documentElement` for
 * assertions, and only reaches for `globalThis.document` (via an
 * `unknown` cast, confined to these two helpers) when wiring the stub in
 * for `../index.ts` to read at require-time. */
let fakeDocumentElement: FakeDocumentElement | undefined;

function installFakeDocument(): void {
  fakeDocumentElement = makeFakeDocumentElement();
  (globalThis as unknown as { document: { documentElement: FakeDocumentElement } }).document = {
    documentElement: fakeDocumentElement,
  };
}

function uninstallFakeDocument(): void {
  fakeDocumentElement = undefined;
  delete (globalThis as { document?: unknown }).document;
}

function dirAttribute(): string | null {
  return fakeDocumentElement?.getAttribute("dir") ?? null;
}

/** Requires `../index` fresh (after `resetModules`) with `Platform.OS`
 * forced on the SAME module instance the fresh import will resolve. */
function loadI18nModule(): typeof import("../index") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- fresh require after resetModules, must match react-native's freshly-reset instance
  const { Platform } = require("react-native") as typeof import("react-native");
  Platform.OS = "web";
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- fresh require after resetModules
  return require("../index") as typeof import("../index");
}

describe("web boot: RTL persistence without an infinite reload loop", () => {
  afterEach(() => {
    delete globalWithDom.localStorage;
    uninstallFakeDocument();
    jest.resetModules();
  });

  it("[regression] persisted RTL locale on web resolves applyPersistedLocaleOnLaunch with requiresRestart: false", async () => {
    jest.resetModules();
    const storage = makeFakeLocalStorage();
    storage.setItem(LANGUAGE_STORAGE_KEY, "ckb");
    globalWithDom.localStorage = storage;
    installFakeDocument();

    const { applyPersistedLocaleOnLaunch } = loadI18nModule();
    const result = await applyPersistedLocaleOnLaunch();

    // This is the exact condition that used to trigger a reload on every
    // single boot — asserting it's false is the loop-breaker regression
    // check.
    expect(result.requiresRestart).toBe(false);
  });

  it("seeds the initial i18next language and DOM dir from the persisted locale before first render", () => {
    jest.resetModules();
    const storage = makeFakeLocalStorage();
    storage.setItem(LANGUAGE_STORAGE_KEY, "ckb");
    globalWithDom.localStorage = storage;
    installFakeDocument();

    const i18n = loadI18nModule().default;

    expect(i18n.language).toBe("ckb");
    expect(dirAttribute()).toBe("rtl");
  });

  it("defaults to ltr on web when nothing is persisted (device-detected 'en' in this test env)", () => {
    jest.resetModules();
    globalWithDom.localStorage = makeFakeLocalStorage();
    installFakeDocument();

    const i18n = loadI18nModule().default;

    expect(i18n.language).toBe("en");
    expect(dirAttribute()).toBe("ltr");
  });

  it("changeLocale to ckb flips the DOM dir attribute to rtl (direction flips from the LTR default)", async () => {
    jest.resetModules();
    globalWithDom.localStorage = makeFakeLocalStorage();
    installFakeDocument();

    const { changeLocale } = loadI18nModule();

    const toCkb = await changeLocale("ckb");
    expect(toCkb.requiresRestart).toBe(true);
    expect(dirAttribute()).toBe("rtl");
  });

  it("changeLocale to en flips the DOM dir attribute back to ltr (direction flips from an RTL session)", async () => {
    jest.resetModules();
    globalWithDom.localStorage = makeFakeLocalStorage();
    installFakeDocument();

    const { changeLocale } = loadI18nModule();
    // Simulates a boot that's already RTL (e.g. `forceRTL(true)` took full
    // effect on the previous reload) — `I18nManager.isRTL` only ever
    // changes across a reload, never mid-session, so this mirrors what a
    // real "switch back to English" tap looks like rather than what a
    // same-session, no-reload-in-between call would (mis)report.
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- same fresh instance changeLocale() above already resolved against
    const { I18nManager } = require("react-native") as typeof import("react-native");
    I18nManager.isRTL = true;

    const toEn = await changeLocale("en");
    expect(toEn.requiresRestart).toBe(true);
    expect(dirAttribute()).toBe("ltr");
  });

  it("reads the exact key/value AsyncStorage's own web implementation writes to window.localStorage", async () => {
    jest.resetModules();
    globalWithDom.localStorage = makeFakeLocalStorage();

    // Deep-import the REAL (unmocked — jest.setup.js only mocks the bare
    // "@react-native-async-storage/async-storage" specifier)
    // implementation that ships for web, proving `readPersistedLocaleWebSync`
    // (inside ../index.ts) targets the exact same storage key/value shape
    // AsyncStorage itself produces on web, rather than assuming it.
    // NOTE: the explicit ".js" extension matters — omitting it lets this
    // project's react-native/jest platform-extension resolution pick
    // `AsyncStorage.native.js` (which throws outside a real native host)
    // instead of the plain web-targeted build.
    type AsyncStorageWebModule = {
      default: { setItem: (key: string, value: string) => Promise<void> };
    };
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- deep import of the real (unmocked) web build, see comment above
    const asyncStorageWebModule = require(
      "@react-native-async-storage/async-storage/lib/commonjs/AsyncStorage.js",
    ) as AsyncStorageWebModule;
    const AsyncStorageWeb = asyncStorageWebModule.default;

    await AsyncStorageWeb.setItem(LANGUAGE_STORAGE_KEY, "ar");

    // `readPersistedLocaleWebSync` (module-load side effect inside
    // ../index.ts) runs synchronously as soon as it's required below —
    // reading it back correctly as "ar" is the empirical proof that it
    // targets the exact key/value AsyncStorage's real web build wrote
    // above, not an assumed key scheme.
    const mod = loadI18nModule();
    expect(mod.default.language).toBe("ar");

    const result = await mod.applyPersistedLocaleOnLaunch();
    expect(result.requiresRestart).toBe(false);
  });
});

describe("native boot: unchanged behavior (byte-identical to pre-fix)", () => {
  afterEach(() => {
    jest.resetModules();
  });

  it("still resolves requiresRestart: true when a persisted RTL locale disagrees with the detected one", async () => {
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- fresh require after resetModules
    const AsyncStorage = require("@react-native-async-storage/async-storage") as {
      setItem: (key: string, value: string) => Promise<void>;
    };
    await AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, "ckb");

    // eslint-disable-next-line @typescript-eslint/no-require-imports -- fresh require after resetModules
    const { Platform } = require("react-native") as typeof import("react-native");
    expect(Platform.OS).not.toBe("web"); // sanity: default test platform is native

    // eslint-disable-next-line @typescript-eslint/no-require-imports -- fresh require after resetModules
    const { applyPersistedLocaleOnLaunch } = require("../index") as typeof import("../index");
    const result = await applyPersistedLocaleOnLaunch();

    // Native persists I18nManager.forceRTL natively — this restart request
    // is expected and harmless there (the loop was web-only).
    expect(result.requiresRestart).toBe(true);
  });
});
