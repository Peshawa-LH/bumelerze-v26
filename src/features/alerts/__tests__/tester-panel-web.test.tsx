/**
 * The tester's "This device" controls on the web build, with a fake browser
 * and a fake server: permission is asked first, the worker is registered at
 * the app's base with the app's scope, the subscription and the coarse alert
 * places reach the server, and turning off unsubscribes both sides. Also the
 * iPhone (Home Screen needed) and unconfigured cases, and the test alert.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Platform } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import i18n from "@/i18n";
import { usePrefsStore } from "@/features/onboarding";

import { AlertsTesterPanel } from "../components/AlertsTesterPanel";
import { useAlertDeviceStore } from "../store";
import type { AlertsTransport } from "../transport";
import { AlertsError, type AlertAccess } from "../types";
import type { BrowserEnv, PushSubscriptionLike } from "../web-push";

jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  getSupabaseClient: () => null,
  signInAnonymously: () => Promise.resolve(),
}));

const VAPID = "BMC0pPjw9ICMY-_R7zlWMDlqoB6XhQRsPbFNFrST55eFGtVmR3LoM4nxFN9HHH5mK4yOUdrXbFa3vLiodH_0mrw";
const TESTER: AlertAccess = { mode: "testers", tester: true, enabled: true, canManage: false };

function fakeTransport(over: Partial<AlertsTransport> = {}): jest.Mocked<AlertsTransport> {
  return {
    fetchAccess: jest.fn(),
    registerWebPush: jest.fn(() => Promise.resolve()),
    unregisterWebPush: jest.fn(() => Promise.resolve()),
    savePreferences: jest.fn(() => Promise.resolve()),
    sendTest: jest.fn(() => Promise.resolve(1)),
    fetchOverview: jest.fn(),
    setMode: jest.fn(),
    addTester: jest.fn(),
    removeTester: jest.fn(),
    ...over,
  } as jest.Mocked<AlertsTransport>;
}

function fakeBrowser(opts: { permission?: "granted" | "denied"; ios?: boolean; standalone?: boolean } = {}) {
  let subscription: PushSubscriptionLike | null = null;
  const unsubscribe = jest.fn(() => {
    subscription = null;
    return Promise.resolve(true);
  });
  const registration = {
    pushManager: {
      getSubscription: jest.fn(() => Promise.resolve(subscription)),
      subscribe: jest.fn(() => {
        subscription = {
          endpoint: "https://fcm.googleapis.com/fcm/send/device-1",
          options: { applicationServerKey: null },
          toJSON: () => ({
            endpoint: "https://fcm.googleapis.com/fcm/send/device-1",
            keys: { p256dh: "P".repeat(87), auth: "A".repeat(22) },
          }),
          unsubscribe,
        };
        return Promise.resolve(subscription);
      }),
    },
  };
  const register = jest.fn(() => Promise.resolve(registration));
  const requestPermission = jest.fn(() => Promise.resolve(opts.permission ?? "granted"));
  const appended: { tag: string; attrs: Record<string, string> }[] = [];
  const env: BrowserEnv = {
    navigator: {
      userAgent: opts.ios ? "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)" : "Mozilla/5.0 (Linux; Android 14) Chrome/130",
      standalone: opts.standalone ?? false,
      serviceWorker: {
        register,
        getRegistration: jest.fn(() => Promise.resolve(subscription ? registration : undefined)),
        ready: Promise.resolve(registration),
      },
    },
    window: {
      PushManager: function PushManager() {},
      Notification: { permission: "default", requestPermission },
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
  return { env, register, requestPermission, registration, unsubscribe, appended };
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

describe("AlertsTesterPanel on the web", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
    Platform.OS = "web";
    process.env.EXPO_PUBLIC_VAPID_PUBLIC_KEY = VAPID;
    useAlertDeviceStore.setState({ deviceOn: false, endpoint: null, syncedKey: null });
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

  it("turns alerts on: permission first, worker at the app base, device and coarse places to the server", async () => {
    const transport = fakeTransport();
    const browser = fakeBrowser();
    await renderPanel(transport, browser.env);
    expect(await screen.findByText("Alerts are off on this device.")).toBeTruthy();
    expect(screen.getByText("Near me uses your place from My location: ⁨Hawler⁩.")).toBeTruthy();

    await fireEvent.press(screen.getByTestId("alerts-device-on"));
    await waitFor(() => expect(screen.getByText("Alerts are on for this device.")).toBeTruthy());

    expect(browser.requestPermission).toHaveBeenCalledTimes(1);
    expect(browser.register).toHaveBeenCalledWith("/push-sw.js", { scope: "/" });
    expect(transport.registerWebPush).toHaveBeenCalledWith(
      { endpoint: "https://fcm.googleapis.com/fcm/send/device-1", p256dh: "P".repeat(87), auth: "A".repeat(22) },
      "en",
    );
    expect(transport.savePreferences).toHaveBeenCalledWith({
      nearMeTier: "m3",
      nearMeLat: 36.2,
      nearMeLon: 44,
      anotherTier: "m4",
      anotherLat: 35.55,
      anotherLon: 45.45,
      language: "en",
    });
    expect(useAlertDeviceStore.getState()).toMatchObject({
      deviceOn: true,
      endpoint: "https://fcm.googleapis.com/fcm/send/device-1",
    });
    expect(useAlertDeviceStore.getState().syncedKey).not.toBeNull();
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
    expect(transport.unregisterWebPush).toHaveBeenCalledWith("https://fcm.googleapis.com/fcm/send/device-1");
    expect(useAlertDeviceStore.getState().deviceOn).toBe(false);
  });

  it("permission denied: says so, nothing is registered", async () => {
    const transport = fakeTransport();
    const browser = fakeBrowser({ permission: "denied" });
    await renderPanel(transport, browser.env);
    await fireEvent.press(await screen.findByTestId("alerts-device-on"));
    expect(await screen.findByText(/Notifications are blocked for this site/)).toBeTruthy();
    expect(browser.register).not.toHaveBeenCalled();
    expect(transport.registerWebPush).not.toHaveBeenCalled();
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

  it("iPhone in the browser: explains Add to Home Screen, adds the web app manifest", async () => {
    const browser = fakeBrowser({ ios: true, standalone: false });
    await renderPanel(fakeTransport(), browser.env);
    expect(screen.getByTestId("alerts-device-ios-home-screen")).toBeTruthy();
    expect(screen.getByText(/Add to Home Screen/)).toBeTruthy();
    await waitFor(() => expect(browser.appended.some((n) => n.attrs.rel === "manifest")).toBe(true));
    expect(browser.appended.find((n) => n.attrs.rel === "manifest")?.attrs.href).toBe("/manifest.webmanifest");
  });

  it("iPhone opened from the Home Screen: the normal controls", async () => {
    await renderPanel(fakeTransport(), fakeBrowser({ ios: true, standalone: true }).env);
    expect(await screen.findByTestId("alerts-device-on")).toBeTruthy();
  });

  it("a build without the public key says alerts are not set up", async () => {
    delete process.env.EXPO_PUBLIC_VAPID_PUBLIC_KEY;
    await renderPanel(fakeTransport(), fakeBrowser().env);
    expect(screen.getByTestId("alerts-device-not-configured")).toBeTruthy();
  });

  it("a browser without push says so", async () => {
    await renderPanel(fakeTransport(), null);
    expect(screen.getByTestId("alerts-device-unsupported")).toBeTruthy();
  });

  it("abroad (auto place out of range): near me has no place", async () => {
    usePrefsStore.setState({ referenceOutOfRange: true });
    await renderPanel(fakeTransport(), fakeBrowser().env);
    expect(await screen.findByText(/Near me needs your place/)).toBeTruthy();
  });

  it("the test alert: sent, then too soon", async () => {
    const transport = fakeTransport();
    await renderPanel(transport, fakeBrowser().env);
    await fireEvent.press(screen.getByTestId("alerts-send-test"));
    expect(await screen.findByText(/Test alert sent/)).toBeTruthy();
    transport.sendTest.mockRejectedValueOnce(new AlertsError("too_soon"));
    await fireEvent.press(screen.getByTestId("alerts-send-test"));
    expect(await screen.findByText("Wait a minute before the next test.")).toBeTruthy();
  });
});
