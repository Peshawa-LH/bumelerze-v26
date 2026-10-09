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
import { parseAccess, parseOverview, toAlertsError, type AlertsTransport } from "../transport";
import {
  detectSupport,
  ensureWebAppManifest,
  isIosDevice,
  keysOf,
  subscribeBrowser,
  urlBase64ToUint8Array,
  type BrowserEnv,
} from "../web-push";

jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  getSupabaseClient: () => null,
  signInAnonymously: () => Promise.resolve(),
}));

const VAPID = "BMC0pPjw9ICMY-_R7zlWMDlqoB6XhQRsPbFNFrST55eFGtVmR3LoM4nxFN9HHH5mK4yOUdrXbFa3vLiodH_0mrw";

function env(over: Partial<BrowserEnv["navigator"]> = {}, win: Partial<BrowserEnv["window"]> = {}): BrowserEnv {
  return {
    navigator: {
      userAgent: "Mozilla/5.0 (X11; Linux x86_64) Chrome/130",
      serviceWorker: {
        register: jest.fn(),
        getRegistration: jest.fn(),
        ready: Promise.resolve({ pushManager: { getSubscription: jest.fn(), subscribe: jest.fn() } }),
      },
      ...over,
    },
    window: {
      PushManager: {},
      Notification: { permission: "default", requestPermission: jest.fn() },
      ...win,
    },
  };
}

describe("detectSupport", () => {
  it("native app, no key, no browser, iPhone outside the Home Screen, no push, supported", () => {
    expect(detectSupport("ios", VAPID, env())).toBe("native");
    expect(detectSupport("web", null, env())).toBe("not-configured");
    expect(detectSupport("web", VAPID, null)).toBe("unsupported");
    expect(detectSupport("web", VAPID, env({ userAgent: "iPhone OS 18" }))).toBe("ios-home-screen");
    expect(detectSupport("web", VAPID, env({ userAgent: "iPhone OS 18", standalone: true }))).toBe("supported");
    expect(detectSupport("web", VAPID, env({}, { PushManager: undefined }))).toBe("unsupported");
    expect(detectSupport("web", VAPID, env())).toBe("supported");
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

  it("replaces a subscription made with another server key", async () => {
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

  it("adds the manifest links once, under the base path", () => {
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
    ensureWebAppManifest(e, "/app");
    ensureWebAppManifest(e, "/app");
    expect(appended.map((n) => n.attrs.rel ?? n.attrs.name)).toEqual([
      "manifest",
      "apple-touch-icon",
      "apple-mobile-web-app-capable",
    ]);
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
