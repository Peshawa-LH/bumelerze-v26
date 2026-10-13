/**
 * Small pieces of the alert client (migration 0062): browser support
 * detection, the VAPID key decoding, replacing a subscription made with an old
 * server key, the coarse preference payload, the auto-sync that only runs
 * while alerts are on here, and the server error tokens.
 */
import { act, renderHook, waitFor } from "@testing-library/react-native";

import i18n from "@/i18n";
import { usePrefsStore } from "@/features/onboarding";

import { buildPreferencesPayload, coarse, useAlertPrefsAutoSync } from "../prefs-sync";
import { useAlertDeviceStore } from "../store";
import { deviceKindLabel } from "../components/AlertsTesterPanel";
import { parseAccess, parseDevices, parseOverview, toAlertsError, type AlertsTransport } from "../transport";
import {
  browserPermission,
  detectSupport,
  ensureWebAppManifest,
  iosVersion,
  isIosDevice,
  keysOf,
  subscribeBrowser,
  urlBase64ToUint8Array,
  webBase,
  type BrowserEnv,
} from "../web-push";

jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  getSupabaseClient: () => null,
  signInAnonymously: () => Promise.resolve(),
}));

const VAPID = "BMC0pPjw9ICMY-_R7zlWMDlqoB6XhQRsPbFNFrST55eFGtVmR3LoM4nxFN9HHH5mK4yOUdrXbFa3vLiodH_0mrw";

type Loose<T> = { [K in keyof T]?: T[K] | undefined };

/** Drops keys set to undefined (the browser simply lacks them). */
function defined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

function env(over: Loose<BrowserEnv["navigator"]> = {}, win: Loose<BrowserEnv["window"]> = {}): BrowserEnv {
  const navigator: Loose<BrowserEnv["navigator"]> = {
    userAgent: "Mozilla/5.0 (X11; Linux x86_64) Chrome/130",
    serviceWorker: {
      register: jest.fn(),
      getRegistration: jest.fn(),
      ready: Promise.resolve({ pushManager: { getSubscription: jest.fn(), subscribe: jest.fn() } }),
    },
    ...over,
  };
  const window: Loose<BrowserEnv["window"]> = {
    PushManager: {},
    Notification: { permission: "default", requestPermission: jest.fn() },
    ...win,
  };
  return {
    navigator: defined(navigator) as BrowserEnv["navigator"],
    window: defined(window) as BrowserEnv["window"],
  };
}

const IPHONE_18 = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Mobile Safari/604.1";
const IPHONE_16_3 = "Mozilla/5.0 (iPhone; CPU iPhone OS 16_3 like Mac OS X) Version/16.3 Mobile Safari/604.1";
const IPAD_AS_MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.4 Safari/605.1.15";
const NO_PUSH = { PushManager: undefined, Notification: undefined };

describe("detectSupport (review note 11.3)", () => {
  it("native app, no key, no browser, no push, supported", () => {
    expect(detectSupport("ios", VAPID, env())).toBe("native");
    expect(detectSupport("android", VAPID, env())).toBe("native");
    expect(detectSupport("web", null, env())).toBe("not-configured");
    expect(detectSupport("web", VAPID, null)).toBe("unsupported");
    expect(detectSupport("web", VAPID, env({}, { PushManager: undefined }))).toBe("unsupported");
    expect(detectSupport("web", VAPID, env())).toBe("supported");
  });

  it("iPhone in Safari has no push APIs: Home Screen app needed, not 'unsupported' or 'blocked'", () => {
    expect(detectSupport("web", VAPID, env({ userAgent: IPHONE_18, serviceWorker: undefined }, NO_PUSH))).toBe(
      "ios-browser",
    );
    // Chrome on iPhone (CriOS) is the same WebKit: same answer.
    expect(detectSupport("web", VAPID, env({ userAgent: `${IPHONE_18} CriOS/130` }, NO_PUSH))).toBe("ios-browser");
  });

  it("iPhone Home Screen app: supported; without push APIs it is an iOS too old", () => {
    expect(detectSupport("web", VAPID, env({ userAgent: IPHONE_18, standalone: true }))).toBe("supported");
    expect(detectSupport("web", VAPID, env({ userAgent: IPHONE_18, standalone: true }, NO_PUSH))).toBe("ios-update");
  });

  it("iOS older than 16.4: needs an update, in Safari or on the Home Screen", () => {
    expect(detectSupport("web", VAPID, env({ userAgent: IPHONE_16_3 }, NO_PUSH))).toBe("ios-update");
    expect(detectSupport("web", VAPID, env({ userAgent: IPHONE_16_3, standalone: true }, NO_PUSH))).toBe("ios-update");
  });

  it("iPad that says it is a Mac: iOS rules; a real Mac's Safari 16+ needs no Home Screen", () => {
    const ipad = { userAgent: IPAD_AS_MAC, platform: "MacIntel", maxTouchPoints: 5 };
    expect(detectSupport("web", VAPID, env(ipad, NO_PUSH))).toBe("ios-browser");
    expect(detectSupport("web", VAPID, env({ ...ipad, standalone: true }))).toBe("supported");
    const mac = { userAgent: IPAD_AS_MAC, platform: "MacIntel", maxTouchPoints: 0 };
    expect(detectSupport("web", VAPID, env(mac))).toBe("supported");
    expect(detectSupport("web", VAPID, env(mac, { PushManager: undefined }))).toBe("unsupported");
  });

  it("reads the iOS version from the user agent", () => {
    expect(iosVersion({ userAgent: IPHONE_18 })).toEqual([18, 0]);
    expect(iosVersion({ userAgent: "Mozilla/5.0 (iPad; CPU OS 16_4 like Mac OS X)" })).toEqual([16, 4]);
    expect(iosVersion({ userAgent: IPAD_AS_MAC })).toEqual([17, 4]);
    expect(iosVersion({ userAgent: "Mozilla/5.0 (Linux; Android 14)" })).toBeNull();
  });

  it("the browser's permission, or null without the API", () => {
    expect(browserPermission(env({}, { Notification: { permission: "denied", requestPermission: jest.fn() } }))).toBe(
      "denied",
    );
    expect(browserPermission(env({}, NO_PUSH))).toBeNull();
    expect(browserPermission(null)).toBeNull();
  });

  it("an iPad that says it is a Mac is still iOS", () => {
    expect(isIosDevice({ userAgent: "Macintosh", platform: "MacIntel", maxTouchPoints: 5 })).toBe(true);
    expect(isIosDevice({ userAgent: "Macintosh", platform: "MacIntel", maxTouchPoints: 0 })).toBe(false);
  });
});

describe("web push keys", () => {
  it("decodes the base64url VAPID key to its 65 bytes", () => {
    const bytes = urlBase64ToUint8Array(VAPID);
    expect(bytes).toHaveLength(65);
    expect(bytes[0]).toBe(4);
  });

  it("refuses a subscription without keys", () => {
    expect(() =>
      keysOf({ endpoint: "x", toJSON: () => ({ endpoint: "x" }), unsubscribe: jest.fn() }),
    ).toThrow();
  });

  it("registers the worker at the root of app.bumelerze.com (no /app base)", async () => {
    const created = {
      endpoint: "https://fcm.googleapis.com/x",
      toJSON: () => ({ endpoint: "https://fcm.googleapis.com/x", keys: { p256dh: "p", auth: "a" } }),
      unsubscribe: jest.fn(),
    };
    const registration = {
      pushManager: {
        getSubscription: jest.fn(() => Promise.resolve(null)),
        subscribe: jest.fn(() => Promise.resolve(created)),
      },
    };
    const e = env({
      serviceWorker: {
        register: jest.fn(() => Promise.resolve(registration)),
        getRegistration: jest.fn(),
        ready: Promise.resolve(registration),
      },
    });
    expect(webBase()).toBe("");
    await subscribeBrowser(e, webBase(), VAPID);
    expect(e.navigator.serviceWorker?.register).toHaveBeenCalledWith("/push-sw.js", { scope: "/" });
  });

  it("replaces a subscription made with another server key (also under a subpath build)", async () => {
    const oldUnsubscribe = jest.fn(() => Promise.resolve(true));
    const oldSub = {
      endpoint: "https://fcm.googleapis.com/old",
      options: { applicationServerKey: new Uint8Array([1, 2, 3]).buffer },
      toJSON: () => ({ endpoint: "https://fcm.googleapis.com/old", keys: { p256dh: "p", auth: "a" } }),
      unsubscribe: oldUnsubscribe,
    };
    const newSub = {
      endpoint: "https://fcm.googleapis.com/new",
      toJSON: () => ({ endpoint: "https://fcm.googleapis.com/new", keys: { p256dh: "p2", auth: "a2" } }),
      unsubscribe: jest.fn(),
    };
    const registration = {
      pushManager: {
        getSubscription: jest.fn(() => Promise.resolve(oldSub)),
        subscribe: jest.fn(() => Promise.resolve(newSub)),
      },
    };
    const e = env({
      serviceWorker: {
        register: jest.fn(() => Promise.resolve(registration)),
        getRegistration: jest.fn(),
        ready: Promise.resolve(registration),
      },
    });
    const keys = await subscribeBrowser(e, "/app", VAPID);
    expect(e.navigator.serviceWorker?.register).toHaveBeenCalledWith("/app/push-sw.js", { scope: "/app/" });
    expect(oldUnsubscribe).toHaveBeenCalled();
    expect(registration.pushManager.subscribe).toHaveBeenCalledWith(
      expect.objectContaining({ userVisibleOnly: true }),
    );
    expect(keys).toEqual({ endpoint: "https://fcm.googleapis.com/new", p256dh: "p2", auth: "a2" });
  });

  it("adds the manifest links once, at the root, or under a subpath build's base", () => {
    const appended: { attrs: Record<string, string> }[] = [];
    const e: BrowserEnv = {
      ...env(),
      document: {
        head: { appendChild: (node) => appended.push(node as { attrs: Record<string, string> }) },
        querySelector: (selector) =>
          appended.find((n) => selector.includes(n.attrs.rel ?? n.attrs.name ?? "none")) ?? null,
        createElement: () => {
          const node = { attrs: {} as Record<string, string>, setAttribute: (k: string, v: string) => (node.attrs[k] = v) };
          return node;
        },
      },
    };
    ensureWebAppManifest(e, webBase());
    ensureWebAppManifest(e, webBase());
    expect(appended.map((n) => n.attrs.rel ?? n.attrs.name)).toEqual([
      "manifest",
      "apple-touch-icon",
      "apple-mobile-web-app-capable",
    ]);
    expect(appended[0]?.attrs.href).toBe("/manifest.webmanifest");
    expect(appended[1]?.attrs.href).toBe("/push-icon-192.png");
    appended.length = 0;
    ensureWebAppManifest(e, "/app");
    expect(appended[0]?.attrs.href).toBe("/app/manifest.webmanifest");
  });
});

describe("preferences payload", () => {
  const base = {
    nearMeTier: "m3",
    referencePlace: { placeId: "erbil", lat: 36.19, lon: 44.01 },
    anotherPlace: null,
    anotherPlaceTier: "off",
  };

  it("snaps both points to 0.05 degree; no other place means off", () => {
    expect(coarse(36.1937)).toBe(36.2);
    expect(coarse(44.0089)).toBe(44);
    expect(buildPreferencesPayload(base, "ckb")).toEqual({
      nearMeTier: "m3",
      nearMeLat: 36.2,
      nearMeLon: 44,
      anotherTier: "off",
      anotherLat: null,
      anotherLon: null,
      language: "ckb",
    });
  });

  it("abroad with an automatic place: no near-me point; a chosen place stays", () => {
    expect(buildPreferencesPayload({ ...base, referenceOutOfRange: true, referenceSource: "auto" }, "en").nearMeLat).toBeNull();
    expect(buildPreferencesPayload({ ...base, referenceOutOfRange: true, referenceSource: "manual" }, "en").nearMeLat).toBe(36.2);
  });

  it("an unknown language is sent as English", () => {
    expect(buildPreferencesPayload(base, "fr").language).toBe("en");
  });
});

describe("useAlertPrefsAutoSync", () => {
  function transport(): jest.Mocked<AlertsTransport> {
    return { savePreferences: jest.fn(() => Promise.resolve()) } as unknown as jest.Mocked<AlertsTransport>;
  }

  beforeEach(async () => {
    await i18n.changeLanguage("en");
    usePrefsStore.setState({
      nearMeTier: "m3",
      referencePlace: { placeId: "erbil", lat: 36.19, lon: 44.01 },
      referenceOutOfRange: false,
      referenceSource: "auto",
      anotherPlace: null,
      anotherPlaceTier: "off",
    });
  });

  it("no request at all while alerts are off on this device", async () => {
    useAlertDeviceStore.setState({ deviceOn: false, endpoint: null, syncedKey: null });
    const t = transport();
    await renderHook(() => useAlertPrefsAutoSync(t));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(t.savePreferences).not.toHaveBeenCalled();
  });

  it("while on: saves once, then again only after a change (e.g. My location moved)", async () => {
    useAlertDeviceStore.setState({ deviceOn: true, endpoint: "e", syncedKey: null });
    const t = transport();
    await renderHook(() => useAlertPrefsAutoSync(t));
    await waitFor(() => expect(t.savePreferences).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(useAlertDeviceStore.getState().syncedKey).not.toBeNull());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(t.savePreferences).toHaveBeenCalledTimes(1);
    await act(async () => {
      usePrefsStore.setState({ referencePlace: { placeId: "slemani", lat: 35.56, lon: 45.43 } });
    });
    await waitFor(() => expect(t.savePreferences).toHaveBeenCalledTimes(2));
    expect(t.savePreferences.mock.calls[1]?.[0]).toMatchObject({ nearMeLat: 35.55, nearMeLon: 45.45 });
  });
});

describe("transport parsing", () => {
  it("maps server tokens to codes", () => {
    expect(toAlertsError({ message: "alerts_send_test: too_soon" }).code).toBe("too_soon");
    expect(toAlertsError({ message: "alerts_register_web_push: not_enabled" }).code).toBe("not_enabled");
    expect(toAlertsError({ message: "alerts_register_web_push: endpoint_invalid" }).code).toBe("invalid");
    expect(toAlertsError({ message: "admin_alert_tester_add: not_found" }).code).toBe("not_found");
    expect(toAlertsError({ code: "PGRST202", message: "Could not find the function public.alerts_my_access" }).code).toBe(
      "unavailable",
    );
    expect(toAlertsError(new TypeError("Network request failed")).code).toBe("network");
  });

  it("reads my devices; a phone app has no endpoint", () => {
    expect(
      parseDevices([
        {
          push_subscription_id: "d1",
          kind: "web",
          endpoint: "https://fcm.googleapis.com/fcm/send/x",
          locale: "ckb",
          created_at: "2026-10-12T10:00:00Z",
          last_ok_at: null,
          disabled: false,
        },
        { push_subscription_id: "d2", kind: "expo", endpoint: null, locale: "en", created_at: "2026-10-01T00:00:00Z", last_ok_at: "2026-10-02T00:00:00Z", disabled: true },
      ]),
    ).toEqual([
      {
        id: "d1",
        kind: "web",
        endpoint: "https://fcm.googleapis.com/fcm/send/x",
        locale: "ckb",
        createdAt: Date.UTC(2026, 9, 12, 10),
        lastOkAt: null,
        disabled: false,
      },
      {
        id: "d2",
        kind: "expo",
        endpoint: null,
        locale: "en",
        createdAt: Date.UTC(2026, 9, 1),
        lastOkAt: Date.UTC(2026, 9, 2),
        disabled: true,
      },
    ]);
    expect(parseDevices(null)).toEqual([]);
  });

  it("names a device by its push service", () => {
    const t = ((key: string) => key) as unknown as Parameters<typeof deviceKindLabel>[1];
    const label = (endpoint: string | null, kind: "web" | "expo" = "web") => deviceKindLabel({ kind, endpoint }, t);
    expect(label("https://fcm.googleapis.com/fcm/send/x")).toBe("alerts.devices.chrome");
    expect(label("https://web.push.apple.com/Q")).toBe("alerts.devices.safari");
    expect(label("https://updates.push.services.mozilla.com/wpush/v2/x")).toBe("alerts.devices.firefox");
    expect(label("https://wns2-db5p.notify.windows.com/w/?token=x")).toBe("alerts.devices.edge");
    expect(label("not a url")).toBe("alerts.devices.browser");
    expect(label(null, "expo")).toBe("alerts.devices.phoneApp");
  });

  it("reads access and the admin overview", () => {
    expect(parseAccess({ mode: "public", tester: false, enabled: true, can_manage: false })).toEqual({
      mode: "public",
      tester: false,
      enabled: true,
      canManage: false,
    });
    const o = parseOverview({
      mode: "testers",
      can_manage: true,
      devices: 3,
      waiting: "0",
      testers: [{ user_id: "u1", username: "peshawa", display_name: "P", via: "rank", devices: 2 }],
      runs: [
        {
          run_id: "r1",
          started_at: "2026-10-09T10:00:00Z",
          mode: "testers",
          events: 1,
          planned: 2,
          suppressed: 0,
          claimed: 2,
          sent: 2,
          failed: 0,
          gone: 0,
        },
      ],
    });
    expect(o.testers[0]).toEqual({ userId: "u1", username: "peshawa", displayName: "P", via: "rank", devices: 2 });
    expect(o.runs[0]?.sent).toBe(2);
    expect(o.waiting).toBe(0);
  });
});
