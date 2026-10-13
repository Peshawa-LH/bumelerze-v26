/**
 * The tester's alert controls on the web build, with a fake browser and a
 * fake server (review notes 11.3 and 11.5, Stage 2):
 *
 * - turning on: permission first (inside the tap), the worker registered at
 *   the ROOT of app.bumelerze.com, a subscription with the app's VAPID key,
 *   the device registered with the app's language, the coarse places saved;
 *   turning off unsubscribes on both sides;
 * - every environment gets its own plain words: iPhone Safari (Add to Home
 *   Screen steps, never "blocked"), an iOS too old, the Home Screen app,
 *   notifications blocked in a desktop browser (site settings, no button),
 *   no push at all, the native app;
 * - what drifts while the app is closed is repaired on the next visit: a new
 *   endpoint from the browser, a change of language, notifications blocked;
 * - the device list (this device marked, remove) and the test alert.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Platform } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import i18n from "@/i18n";
import { usePrefsStore } from "@/features/onboarding";

import { AlertsNearMePlace } from "../components/AlertsPreferenceNotes";
import { AlertsTesterPanel } from "../components/AlertsTesterPanel";
import { useAlertDeviceStore } from "../store";
import type { AlertsTransport } from "../transport";
import { AlertsError, type AlertAccess, type AlertDevice } from "../types";
import { urlBase64ToUint8Array, type BrowserEnv, type PushSubscriptionLike } from "../web-push";

jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  getSupabaseClient: () => null,
  signInAnonymously: () => Promise.resolve(),
}));

jest.mock("@/features/account/use-account", () => ({
  useAccount: () => ({ userId: "user-1", status: "account" }),
}));

const VAPID = "BMC0pPjw9ICMY-_R7zlWMDlqoB6XhQRsPbFNFrST55eFGtVmR3LoM4nxFN9HHH5mK4yOUdrXbFa3vLiodH_0mrw";
const TESTER: AlertAccess = { mode: "testers", tester: true, enabled: true, canManage: false };
const ENDPOINT = "https://fcm.googleapis.com/fcm/send/device-1";
const KEYS = { p256dh: "P".repeat(87), auth: "A".repeat(22) };

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1";
const ANDROID = "Mozilla/5.0 (Linux; Android 14) Chrome/130";

function fakeTransport(over: Partial<AlertsTransport> = {}): jest.Mocked<AlertsTransport> {
  return {
    fetchAccess: jest.fn(),
    registerWebPush: jest.fn(() => Promise.resolve()),
    unregisterWebPush: jest.fn(() => Promise.resolve()),
    fetchMyDevices: jest.fn(() => Promise.resolve([] as AlertDevice[])),
    savePreferences: jest.fn(() => Promise.resolve()),
    sendTest: jest.fn(() => Promise.resolve(1)),
    fetchOverview: jest.fn(),
    setMode: jest.fn(),
    addTester: jest.fn(),
    removeTester: jest.fn(),
    ...over,
  } as jest.Mocked<AlertsTransport>;
}

function subscriptionFor(endpoint: string, unsubscribe: jest.Mock): PushSubscriptionLike {
  return {
    endpoint,
    options: { applicationServerKey: null },
    toJSON: () => ({ endpoint, keys: KEYS }),
    unsubscribe,
  };
}

interface BrowserOptions {
  /** What the person answers to the permission question. */
  answer?: "granted" | "denied" | "default";
  /** The permission before anything is asked. */
  permission?: "default" | "granted" | "denied";
  userAgent?: string;
  standalone?: boolean;
  /** A subscription the browser already holds. */
  existing?: string;
  /** No PushManager / Notification (iPhone Safari, old browsers). */
  noPush?: boolean;
  subscribeError?: Error;
}

function fakeBrowser(opts: BrowserOptions = {}) {
  let subscription: PushSubscriptionLike | null = null;
  const unsubscribe = jest.fn(() => {
    subscription = null;
    return Promise.resolve(true);
  });
  if (opts.existing) {
    subscription = subscriptionFor(opts.existing, unsubscribe);
  }
  const registration = {
    pushManager: {
      getSubscription: jest.fn(() => Promise.resolve(subscription)),
      subscribe: jest.fn(() => {
        if (opts.subscribeError) {
          return Promise.reject(opts.subscribeError);
        }
        subscription = subscriptionFor(ENDPOINT, unsubscribe);
        return Promise.resolve(subscription);
      }),
    },
  };
  const register = jest.fn(() => Promise.resolve(registration));
  const notification = {
    permission: opts.permission ?? "default",
    requestPermission: jest.fn(() => {
      const answer = opts.answer ?? "granted";
      notification.permission = answer;
      return Promise.resolve(answer);
    }),
  };
  const appended: { tag: string; attrs: Record<string, string> }[] = [];
  const env: BrowserEnv = {
    navigator: {
      userAgent: opts.userAgent ?? ANDROID,
      standalone: opts.standalone ?? false,
      ...(opts.noPush
        ? {}
        : {
            serviceWorker: {
              register,
              getRegistration: jest.fn(() => Promise.resolve(subscription ? registration : undefined)),
              ready: Promise.resolve(registration),
            },
          }),
    },
    window: {
      ...(opts.noPush ? {} : { PushManager: function PushManager() {}, Notification: notification }),
      matchMedia: () => ({ matches: opts.standalone ?? false }),
    },
    document: {
      head: { appendChild: (node: unknown) => appended.push(node as { tag: string; attrs: Record<string, string> }) },
      querySelector: (selector: string) =>
        appended.find((n) => selector.includes(n.attrs.rel ?? n.attrs.name ?? "none")) ?? null,
      createElement: (tag: string) => {
        const node = { tag, attrs: {} as Record<string, string>, setAttribute: (k: string, v: string) => (node.attrs[k] = v) };
        return node;
      },
    },
  };
  return { env, register, registration, unsubscribe, appended, notification };
}

function renderPanel(transport: AlertsTransport, env: BrowserEnv | null, accessValue: AlertAccess = TESTER) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 360, height: 640 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
        <AlertsTesterPanel access={accessValue} transport={transport} env={env} />
      </SafeAreaProvider>
    </QueryClientProvider>,
  );
}

const originalOS = Platform.OS;

beforeEach(async () => {
  await i18n.changeLanguage("en");
  Platform.OS = "web";
  process.env.EXPO_PUBLIC_VAPID_PUBLIC_KEY = VAPID;
  useAlertDeviceStore.setState({ deviceOn: false, endpoint: null, locale: null, syncedKey: null });
  usePrefsStore.setState({
    nearMeTier: "m3",
    referencePlace: { placeId: "erbil", lat: 36.19, lon: 44.01 },
    referenceSource: "auto",
    referenceOutOfRange: false,
    anotherPlace: { placeId: "slemani", lat: 35.5612, lon: 45.4371 },
    anotherPlaceTier: "m4",
  });
});
afterEach(() => {
  cleanup();
  Platform.OS = originalOS;
  delete process.env.EXPO_PUBLIC_VAPID_PUBLIC_KEY;
});

describe("turning alerts on and off (web push registration)", () => {
  it("permission first, the worker at the root scope, the app's key, the device with its language, the places", async () => {
    const transport = fakeTransport();
    const browser = fakeBrowser();
    await renderPanel(transport, browser.env);
    expect(await screen.findByText("Alerts are off on this device.")).toBeTruthy();

    await fireEvent.press(screen.getByTestId("alerts-device-on"));
    await waitFor(() => expect(screen.getByText("Alerts are on for this device.")).toBeTruthy());

    expect(browser.notification.requestPermission).toHaveBeenCalledTimes(1);
    expect(browser.register).toHaveBeenCalledWith("/push-sw.js", { scope: "/" });
    const subscribeArgs = browser.registration.pushManager.subscribe.mock.calls[0] as unknown as [
      { userVisibleOnly: boolean; applicationServerKey: Uint8Array },
    ];
    expect(subscribeArgs[0].userVisibleOnly).toBe(true);
    expect(Array.from(subscribeArgs[0].applicationServerKey)).toEqual(Array.from(urlBase64ToUint8Array(VAPID)));
    expect(transport.registerWebPush).toHaveBeenCalledWith({ endpoint: ENDPOINT, ...KEYS }, "en");
    expect(transport.savePreferences).toHaveBeenCalledWith({
      nearMeTier: "m3",
      nearMeLat: 36.2,
      nearMeLon: 44,
      anotherTier: "m4",
      anotherLat: 35.55,
      anotherLon: 45.45,
      language: "en",
    });
    expect(useAlertDeviceStore.getState()).toMatchObject({ deviceOn: true, endpoint: ENDPOINT, locale: "en" });
    expect(useAlertDeviceStore.getState().syncedKey).not.toBeNull();
    // The button is now the (secondary) way back.
    expect(screen.getByText("Turn off alerts on this device")).toBeTruthy();
  });

  it("registers in the app's language (Sorani)", async () => {
    await i18n.changeLanguage("ckb");
    const transport = fakeTransport();
    await renderPanel(transport, fakeBrowser().env);
    await fireEvent.press(await screen.findByTestId("alerts-device-on"));
    await waitFor(() => expect(transport.registerWebPush).toHaveBeenCalledWith(expect.anything(), "ckb"));
  });

  it("turns alerts off on both sides", async () => {
    const transport = fakeTransport();
    const browser = fakeBrowser();
    await renderPanel(transport, browser.env);
    await fireEvent.press(await screen.findByTestId("alerts-device-on"));
    await waitFor(() => expect(screen.getByTestId("alerts-device-off")).toBeTruthy());
    await fireEvent.press(screen.getByTestId("alerts-device-off"));
    await waitFor(() => expect(screen.getByText("Alerts are off on this device.")).toBeTruthy());
    expect(browser.unsubscribe).toHaveBeenCalled();
    expect(transport.unregisterWebPush).toHaveBeenCalledWith(ENDPOINT);
    expect(useAlertDeviceStore.getState()).toMatchObject({ deviceOn: false, endpoint: null });
  });

  it("the browser handed out a new endpoint since last time: the new one is registered, the old one removed", async () => {
    const old = "https://fcm.googleapis.com/fcm/send/old-device";
    useAlertDeviceStore.setState({ deviceOn: true, endpoint: old, locale: "en", syncedKey: "x" });
    const transport = fakeTransport();
    await renderPanel(transport, fakeBrowser({ permission: "granted", existing: ENDPOINT }).env);
    await waitFor(() => expect(transport.registerWebPush).toHaveBeenCalledWith({ endpoint: ENDPOINT, ...KEYS }, "en"));
    await waitFor(() => expect(transport.unregisterWebPush).toHaveBeenCalledWith(old));
    expect(useAlertDeviceStore.getState().endpoint).toBe(ENDPOINT);
    expect(screen.getByText("Alerts are on for this device.")).toBeTruthy();
  });

  it("the app language changed since alerts were turned on: the device is registered again in the new one", async () => {
    useAlertDeviceStore.setState({ deviceOn: true, endpoint: ENDPOINT, locale: "en", syncedKey: "x" });
    await i18n.changeLanguage("ar");
    const transport = fakeTransport();
    await renderPanel(transport, fakeBrowser({ permission: "granted", existing: ENDPOINT }).env);
    await waitFor(() => expect(transport.registerWebPush).toHaveBeenCalledWith({ endpoint: ENDPOINT, ...KEYS }, "ar"));
    expect(transport.unregisterWebPush).not.toHaveBeenCalled();
    expect(useAlertDeviceStore.getState().locale).toBe("ar");
  });

  it("nothing changed: no request at all on opening the screen", async () => {
    useAlertDeviceStore.setState({ deviceOn: true, endpoint: ENDPOINT, locale: "en", syncedKey: "x" });
    const transport = fakeTransport();
    await renderPanel(transport, fakeBrowser({ permission: "granted", existing: ENDPOINT }).env);
    expect(await screen.findByText("Alerts are on for this device.")).toBeTruthy();
    expect(transport.registerWebPush).not.toHaveBeenCalled();
    expect(transport.unregisterWebPush).not.toHaveBeenCalled();
  });

  it("notifications were blocked in the browser since: the device is removed and the page says how to allow them", async () => {
    useAlertDeviceStore.setState({ deviceOn: true, endpoint: ENDPOINT, locale: "en", syncedKey: "x" });
    const transport = fakeTransport();
    await renderPanel(transport, fakeBrowser({ permission: "denied", existing: ENDPOINT }).env);
    expect(await screen.findByText("Notifications are blocked.")).toBeTruthy();
    await waitFor(() => expect(transport.unregisterWebPush).toHaveBeenCalledWith(ENDPOINT));
    expect(useAlertDeviceStore.getState().deviceOn).toBe(false);
  });
});

describe("plain sentences for what went wrong", () => {
  it("blocked when the person taps Block: site settings help, nothing registered", async () => {
    const transport = fakeTransport();
    const browser = fakeBrowser({ answer: "denied" });
    await renderPanel(transport, browser.env);
    await fireEvent.press(await screen.findByTestId("alerts-device-on"));
    expect(await screen.findByText(/blocked for app\.bumelerze\.com in this browser/)).toBeTruthy();
    expect(screen.getByText("Notifications are blocked.")).toBeTruthy();
    // No button that cannot work: only the browser's settings can undo it.
    expect(screen.queryByTestId("alerts-device-on")).toBeNull();
    expect(screen.queryByText("Open Settings")).toBeNull();
    expect(browser.register).not.toHaveBeenCalled();
    expect(transport.registerWebPush).not.toHaveBeenCalled();
  });

  it("already blocked when the screen opens: the same help, no button", async () => {
    await renderPanel(fakeTransport(), fakeBrowser({ permission: "denied" }).env);
    expect(await screen.findByTestId("alerts-device-denied")).toBeTruthy();
    expect(screen.getByText(/set Notifications to Allow, then reload this page/)).toBeTruthy();
    expect(screen.queryByTestId("alerts-device-on")).toBeNull();
  });

  it("question closed without an answer: asks to try again and choose Allow", async () => {
    await renderPanel(fakeTransport(), fakeBrowser({ answer: "default" }).env);
    await fireEvent.press(await screen.findByTestId("alerts-device-on"));
    expect(await screen.findByText(/You closed the question without choosing/)).toBeTruthy();
    expect(screen.getByTestId("alerts-device-on")).toBeTruthy();
  });

  it("the browser's push service fails: reload and try again", async () => {
    const error = Object.assign(new Error("push service error"), { name: "AbortError" });
    const transport = fakeTransport();
    await renderPanel(transport, fakeBrowser({ subscribeError: error }).env);
    await fireEvent.press(await screen.findByTestId("alerts-device-on"));
    expect(await screen.findByText("This browser could not set up alerts. Reload the page and try again.")).toBeTruthy();
    expect(transport.registerWebPush).not.toHaveBeenCalled();
    expect(useAlertDeviceStore.getState().deviceOn).toBe(false);
  });

  it("offline: no internet connection", async () => {
    const transport = fakeTransport({
      registerWebPush: jest.fn(() => Promise.reject(new TypeError("Network request failed"))),
    });
    await renderPanel(transport, fakeBrowser().env);
    await fireEvent.press(await screen.findByTestId("alerts-device-on"));
    expect(await screen.findByText("No internet connection. Connect and try again.")).toBeTruthy();
    expect(useAlertDeviceStore.getState().deviceOn).toBe(false);
  });

  it("ten devices already: says so", async () => {
    const transport = fakeTransport({
      registerWebPush: jest.fn(() => Promise.reject(new AlertsError("too_many_devices"))),
    });
    await renderPanel(transport, fakeBrowser().env);
    await fireEvent.press(await screen.findByTestId("alerts-device-on"));
    expect(await screen.findByText(/already has alerts on 10 devices/)).toBeTruthy();
    expect(useAlertDeviceStore.getState().deviceOn).toBe(false);
  });
});

describe("each environment in its own words (review note 11.3)", () => {
  it("iPhone Safari: Add to Home Screen steps, never 'blocked', no button, the web app manifest added", async () => {
    const browser = fakeBrowser({ userAgent: IPHONE, noPush: true });
    await renderPanel(fakeTransport(), browser.env);
    expect(screen.getByTestId("alerts-device-ios-browser")).toBeTruthy();
    expect(screen.getByText("Add Bumelerze to your Home Screen to get alerts")).toBeTruthy();
    expect(screen.getByText("Tap the Share button (a square with an arrow pointing up).")).toBeTruthy();
    expect(screen.getByText("Choose Add to Home Screen, then tap Add.")).toBeTruthy();
    expect(screen.getByText("Open Bumelerze from the new icon on your Home Screen.")).toBeTruthy();
    expect(screen.getByText("Come back to this page and turn on alerts.")).toBeTruthy();
    expect(screen.queryByText(/blocked/i)).toBeNull();
    expect(screen.queryByText("Open Settings")).toBeNull();
    expect(screen.queryByTestId("alerts-device-on")).toBeNull();
    await waitFor(() => expect(browser.appended.some((n) => n.attrs.rel === "manifest")).toBe(true));
    expect(browser.appended.find((n) => n.attrs.rel === "manifest")?.attrs.href).toBe("/manifest.webmanifest");
    expect(browser.appended.find((n) => n.attrs.rel === "apple-touch-icon")?.attrs.href).toBe("/push-icon-192.png");
  });

  it("iPad that reports itself as a Mac, in Safari: the same Home Screen steps", async () => {
    const browser = fakeBrowser({
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.4 Safari/605.1.15",
      noPush: true,
    });
    browser.env.navigator.platform = "MacIntel";
    browser.env.navigator.maxTouchPoints = 5;
    await renderPanel(fakeTransport(), browser.env);
    expect(screen.getByTestId("alerts-device-ios-browser")).toBeTruthy();
  });

  it("Mac Safari (no touch): the normal controls, no Home Screen needed", async () => {
    const browser = fakeBrowser({
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.4 Safari/605.1.15",
    });
    browser.env.navigator.platform = "MacIntel";
    browser.env.navigator.maxTouchPoints = 0;
    await renderPanel(fakeTransport(), browser.env);
    expect(await screen.findByTestId("alerts-device-on")).toBeTruthy();
  });

  it("iPhone Home Screen app: the normal controls", async () => {
    await renderPanel(fakeTransport(), fakeBrowser({ userAgent: IPHONE, standalone: true }).env);
    expect(await screen.findByTestId("alerts-device-on")).toBeTruthy();
  });

  it("iPhone Home Screen app with notifications off: the iPhone Settings steps, no button", async () => {
    await renderPanel(fakeTransport(), fakeBrowser({ userAgent: IPHONE, standalone: true, permission: "denied" }).env);
    expect(await screen.findByText(/Open the Settings app, tap Notifications, then Bumelerze/)).toBeTruthy();
    expect(screen.queryByTestId("alerts-device-on")).toBeNull();
  });

  it("iPhone on iOS 15: needs an update", async () => {
    await renderPanel(
      fakeTransport(),
      fakeBrowser({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 15_7 like Mac OS X)", noPush: true }).env,
    );
    expect(screen.getByTestId("alerts-device-ios-update")).toBeTruthy();
    expect(screen.getByText(/Alerts need iOS 16\.4 or newer/)).toBeTruthy();
  });

  it("a build without the public key says alerts are not set up", async () => {
    delete process.env.EXPO_PUBLIC_VAPID_PUBLIC_KEY;
    await renderPanel(fakeTransport(), fakeBrowser().env);
    expect(screen.getByTestId("alerts-device-not-configured")).toBeTruthy();
  });

  it("a browser without push: suggests another browser or the Home Screen app", async () => {
    await renderPanel(fakeTransport(), fakeBrowser({ noPush: true }).env);
    expect(screen.getByTestId("alerts-device-unsupported")).toBeTruthy();
    expect(screen.getByText(/Chrome, Edge, Firefox or Safari/)).toBeTruthy();
    expect(screen.getByText("Alerts cannot reach this device yet.")).toBeTruthy();
  });

  it("no browser at all", async () => {
    await renderPanel(fakeTransport(), null);
    expect(screen.getByTestId("alerts-device-unsupported")).toBeTruthy();
  });

  it("the native app: alerts come with the next version, no Open Settings in the panel", async () => {
    Platform.OS = "ios";
    await renderPanel(fakeTransport(), null);
    expect(screen.getByTestId("alerts-device-native")).toBeTruthy();
    expect(screen.queryByText("Open Settings")).toBeNull();
  });
});

describe("devices and the test alert", () => {
  const OTHER = "https://web.push.apple.com/QOther";
  const devices: AlertDevice[] = [
    {
      id: "d1",
      kind: "web",
      endpoint: ENDPOINT,
      locale: "en",
      createdAt: Date.UTC(2026, 9, 12),
      lastOkAt: Date.UTC(2026, 9, 13),
      disabled: false,
    },
    { id: "d2", kind: "web", endpoint: OTHER, locale: "en", createdAt: Date.UTC(2026, 9, 1), lastOkAt: null, disabled: true },
    { id: "d3", kind: "expo", endpoint: null, locale: "ckb", createdAt: Date.UTC(2026, 9, 2), lastOkAt: null, disabled: false },
  ];

  it("lists the account's devices, marks this one, and removes another", async () => {
    useAlertDeviceStore.setState({ deviceOn: true, endpoint: ENDPOINT, locale: "en", syncedKey: "x" });
    const transport = fakeTransport({ fetchMyDevices: jest.fn(() => Promise.resolve(devices)) });
    await renderPanel(transport, fakeBrowser({ permission: "granted", existing: ENDPOINT }).env);

    expect(await screen.findByText("Chrome or Android browser")).toBeTruthy();
    expect(screen.getByText("Safari (iPhone, iPad or Mac)")).toBeTruthy();
    expect(screen.getByText("Phone app")).toBeTruthy();
    await waitFor(() => expect(screen.getByText("This device")).toBeTruthy());
    expect(screen.getByText(/Stopped: this browser no longer accepts alerts/)).toBeTruthy();
    // The phone app has no endpoint here: removed from that phone.
    expect(screen.queryByTestId("alerts-device-remove-d3")).toBeNull();

    await fireEvent.press(screen.getByLabelText("Remove Safari (iPhone, iPad or Mac)"));
    await waitFor(() => expect(transport.unregisterWebPush).toHaveBeenCalledWith(OTHER));
    await waitFor(() => expect(transport.fetchMyDevices.mock.calls.length).toBeGreaterThan(1));
    // This device stays on.
    expect(useAlertDeviceStore.getState().deviceOn).toBe(true);
  });

  it("removing this device turns alerts off here too", async () => {
    useAlertDeviceStore.setState({ deviceOn: true, endpoint: ENDPOINT, locale: "en", syncedKey: "x" });
    const transport = fakeTransport({ fetchMyDevices: jest.fn(() => Promise.resolve(devices.slice(0, 1))) });
    const browser = fakeBrowser({ permission: "granted", existing: ENDPOINT });
    await renderPanel(transport, browser.env);
    await waitFor(() => expect(screen.getByText("This device")).toBeTruthy());
    await fireEvent.press(screen.getByTestId("alerts-device-remove-d1"));
    await waitFor(() => expect(useAlertDeviceStore.getState().deviceOn).toBe(false));
    expect(browser.unsubscribe).toHaveBeenCalled();
    expect(transport.unregisterWebPush).toHaveBeenCalledWith(ENDPOINT);
  });

  it("no devices yet", async () => {
    await renderPanel(fakeTransport(), fakeBrowser().env);
    expect(await screen.findByTestId("alerts-devices-empty")).toBeTruthy();
  });

  it("the test alert: what happens and when, then the rate limit", async () => {
    const transport = fakeTransport();
    await renderPanel(transport, fakeBrowser().env);
    expect(screen.getByText(/goes through the same system as a real alert/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId("alerts-send-test"));
    expect(await screen.findByText(/Test alert sent\. It should arrive within about two minutes\./)).toBeTruthy();
    transport.sendTest.mockRejectedValueOnce(new AlertsError("too_soon"));
    await fireEvent.press(screen.getByTestId("alerts-send-test"));
    expect(await screen.findByText("Please wait. You can send one test a minute, and 20 a day.")).toBeTruthy();
    transport.sendTest.mockRejectedValueOnce(new AlertsError("no_device"));
    await fireEvent.press(screen.getByTestId("alerts-send-test"));
    expect(await screen.findByText("Turn on alerts on this device first.")).toBeTruthy();
  });
});

describe("near me place", () => {
  function renderPlace() {
    const client = new QueryClient();
    return render(
      <QueryClientProvider client={client}>
        <AlertsNearMePlace />
      </QueryClientProvider>,
    );
  }

  it("names the town from My location", async () => {
    await renderPlace();
    expect(screen.getByText("Near me uses your place from My location: ⁨Hawler⁩.")).toBeTruthy();
  });

  it("abroad (auto place out of range): near me has no place", async () => {
    usePrefsStore.setState({ referenceOutOfRange: true });
    await renderPlace();
    expect(screen.getByText(/Near me needs your place/)).toBeTruthy();
  });
});
