/**
 * The tester's alert controls in the iOS/Android app (Expo push), with a
 * fake server and fake phone calls:
 *
 * - a build made before the Expo account exists has no project id: the
 *   panel keeps the "alerts come with the next version" words, asks for
 *   nothing and fetches no token (no crash, no error text);
 * - turning on: the system permission question first, then the Expo push
 *   token, registered with the app's language, then the coarse places;
 *   turning off removes the token, and an offline Turn off is owed;
 * - "Don't Allow" (or blocked earlier): the blocked state with one button
 *   that opens the app's page in Settings, never a Turn on button that
 *   cannot work; back from Settings with notifications allowed, Turn on
 *   is offered again;
 * - a token that cannot be fetched: a plain sentence, nothing registered;
 * - the device list marks this phone by the id the server gave it.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import * as Linking from "expo-linking";
import { AppState, Platform } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import i18n from "@/i18n";
import { usePrefsStore } from "@/features/onboarding";

import { AlertsTesterPanel } from "../components/AlertsTesterPanel";
import { useAlertDeviceStore } from "../store";
import type { AlertsTransport } from "../transport";
import { AlertsError, type AlertAccess, type AlertDevice } from "../types";
import type { PhoneDeviceOptions } from "../use-expo-push-device";

jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  getSupabaseClient: () => ({
    auth: { getSession: () => Promise.resolve({ data: { session: { user: { id: "user-1" } } } }) },
  }),
  signInAnonymously: () => Promise.resolve(),
}));

jest.mock("@/features/account/use-account", () => ({
  useAccount: () => ({ userId: "user-1", status: "account" }),
}));

jest.mock("expo-linking", () => ({ openSettings: jest.fn(() => Promise.resolve()) }));

const TESTER: AlertAccess = { mode: "testers", tester: true, enabled: true, canManage: false };
const TOKEN = "ExponentPushToken[phone-token-1234]";
const PHONE_ID = "33333333-3333-4333-8333-333333333333";

function fakeTransport(over: Partial<AlertsTransport> = {}): jest.Mocked<AlertsTransport> {
  return {
    fetchAccess: jest.fn(),
    registerWebPush: jest.fn(() => Promise.resolve()),
    unregisterWebPush: jest.fn(() => Promise.resolve()),
    registerExpoPush: jest.fn(() => Promise.resolve(PHONE_ID)),
    unregisterExpoPush: jest.fn(() => Promise.resolve()),
    releaseExpoPush: jest.fn(() => Promise.resolve()),
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

/** The phone: a project id, the permission now and the answer to the question. */
function fakePhone(
  opts: {
    projectId?: string | null;
    permission?: "granted" | "denied" | "default";
    answer?: "granted" | "denied" | "undetermined";
    tokenError?: Error;
  } = {},
) {
  let permission = opts.permission ?? "default";
  const phone = {
    projectId: opts.projectId === undefined ? "project-1" : opts.projectId,
    readPermission: jest.fn(() => Promise.resolve(permission)),
    requestPermission: jest.fn(() => {
      const answer = opts.answer ?? "granted";
      permission = answer === "undetermined" ? "default" : answer;
      return Promise.resolve(answer);
    }),
    fetchToken: jest.fn(() => (opts.tokenError ? Promise.reject(opts.tokenError) : Promise.resolve(TOKEN))),
    setPermission(value: "granted" | "denied" | "default") {
      permission = value;
    },
  };
  return phone;
}

function renderPanel(transport: AlertsTransport, phone: PhoneDeviceOptions) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 360, height: 640 },
          insets: { top: 0, left: 0, right: 0, bottom: 0 },
        }}
      >
        <AlertsTesterPanel access={TESTER} transport={transport} env={null} phone={phone} />
      </SafeAreaProvider>
    </QueryClientProvider>,
  );
}

const originalOS = Platform.OS;

beforeEach(async () => {
  await i18n.changeLanguage("en");
  Platform.OS = "ios";
  useAlertDeviceStore.getState().setPhoneDevice(null);
  useAlertDeviceStore.getState().setPendingRemoval(null);
  usePrefsStore.setState({
    nearMeTier: "m3",
    referencePlace: { placeId: "erbil", lat: 36.19, lon: 44.01 },
    referenceSource: "auto",
    referenceOutOfRange: false,
    anotherPlace: null,
    anotherPlaceTier: "off",
  });
  (Linking.openSettings as jest.Mock).mockClear();
});

afterEach(() => {
  cleanup();
  Platform.OS = originalOS;
});

describe("a build without an EAS project id (today, before the Expo account)", () => {
  it("keeps the 'next version' words: no question, no token, no error", async () => {
    const transport = fakeTransport();
    const phone = fakePhone({ projectId: null });
    await renderPanel(transport, phone);
    expect(screen.getByText("Alerts cannot reach this device yet.")).toBeTruthy();
    expect(screen.getByTestId("alerts-device-native")).toBeTruthy();
    expect(
      screen.getByText(
        "Alerts in the phone app come with its next version. For now, test them in the web app at app.bumelerze.com.",
      ),
    ).toBeTruthy();
    expect(screen.queryByTestId("alerts-device-on")).toBeNull();
    expect(screen.queryByTestId("alerts-device-error")).toBeNull();
    expect(phone.readPermission).not.toHaveBeenCalled();
    expect(phone.requestPermission).not.toHaveBeenCalled();
    expect(phone.fetchToken).not.toHaveBeenCalled();
    expect(transport.registerExpoPush).not.toHaveBeenCalled();
  });
});

describe("turning alerts on and off on the phone (Expo push)", () => {
  it("the system question first, then the token, registered in the app's language, then the places", async () => {
    const transport = fakeTransport();
    const phone = fakePhone();
    await renderPanel(transport, phone);
    expect(await screen.findByText("Alerts are off on this device.")).toBeTruthy();

    await fireEvent.press(screen.getByTestId("alerts-device-on"));
    await waitFor(() => expect(screen.getByText("Alerts are on for this device.")).toBeTruthy());

    expect(phone.requestPermission).toHaveBeenCalledTimes(1);
    expect(phone.fetchToken).toHaveBeenCalledWith("project-1");
    expect(transport.registerExpoPush).toHaveBeenCalledWith(TOKEN, "en");
    expect(transport.registerWebPush).not.toHaveBeenCalled();
    expect(transport.savePreferences).toHaveBeenCalledWith({
      nearMeTier: "m3",
      nearMeLat: 36.2,
      nearMeLon: 44,
      anotherTier: "off",
      anotherLat: null,
      anotherLon: null,
      language: "en",
    });
    expect(useAlertDeviceStore.getState()).toMatchObject({
      deviceOn: true,
      endpoint: null,
      expoToken: TOKEN,
      subscriptionId: PHONE_ID,
      userId: "user-1",
      locale: "en",
    });
    expect(useAlertDeviceStore.getState().syncedKey).not.toBeNull();
    expect(screen.getByText("Turn off alerts on this device")).toBeTruthy();
  });

  it("registers in the app's language (Sorani)", async () => {
    await i18n.changeLanguage("ckb");
    const transport = fakeTransport();
    await renderPanel(transport, fakePhone());
    await fireEvent.press(await screen.findByTestId("alerts-device-on"));
    await waitFor(() => expect(transport.registerExpoPush).toHaveBeenCalledWith(TOKEN, "ckb"));
  });

  it("turns alerts off: the token leaves the server", async () => {
    const transport = fakeTransport();
    await renderPanel(transport, fakePhone());
    await fireEvent.press(await screen.findByTestId("alerts-device-on"));
    await waitFor(() => expect(screen.getByTestId("alerts-device-off")).toBeTruthy());
    await fireEvent.press(screen.getByTestId("alerts-device-off"));
    await waitFor(() => expect(screen.getByText("Alerts are off on this device.")).toBeTruthy());
    expect(transport.unregisterExpoPush).toHaveBeenCalledWith(TOKEN);
    expect(useAlertDeviceStore.getState()).toMatchObject({ deviceOn: false, expoToken: null, pendingRemoval: null });
  });

  it("turned off while offline: off here at once, the removal is owed for later", async () => {
    const transport = fakeTransport({
      unregisterExpoPush: jest.fn(() => Promise.reject(new AlertsError("network"))),
    });
    await renderPanel(transport, fakePhone());
    await fireEvent.press(await screen.findByTestId("alerts-device-on"));
    await waitFor(() => expect(screen.getByTestId("alerts-device-off")).toBeTruthy());
    await fireEvent.press(screen.getByTestId("alerts-device-off"));
    await waitFor(() => expect(screen.getByText("Alerts are off on this device.")).toBeTruthy());
    expect(useAlertDeviceStore.getState()).toMatchObject({ deviceOn: false, pendingRemoval: TOKEN });
  });

  it("'Don't Allow': blocked, with one button that opens Settings, nothing registered", async () => {
    const transport = fakeTransport();
    const phone = fakePhone({ answer: "denied" });
    await renderPanel(transport, phone);
    await fireEvent.press(await screen.findByTestId("alerts-device-on"));
    await waitFor(() => expect(screen.getByText("Notifications are blocked.")).toBeTruthy());
    expect(
      screen.getByText(
        "Notifications are off for Bumelerze on this phone. Tap Open Settings, then Notifications, and allow them. Then come back here.",
      ),
    ).toBeTruthy();
    expect(screen.queryByTestId("alerts-device-on")).toBeNull();
    expect(phone.fetchToken).not.toHaveBeenCalled();
    expect(transport.registerExpoPush).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByTestId("alerts-device-open-settings"));
    expect(Linking.openSettings).toHaveBeenCalledTimes(1);
  });

  it("blocked earlier: the same state when the screen opens; back from Settings allowed, Turn on returns", async () => {
    // React Native's Jest setup already mocks AppState; read its listeners.
    const addListener = AppState.addEventListener as jest.Mock;
    addListener.mockClear();
    const phone = fakePhone({ permission: "denied" });
    await renderPanel(fakeTransport(), phone);
    expect(await screen.findByTestId("alerts-device-open-settings")).toBeTruthy();
    expect(phone.requestPermission).not.toHaveBeenCalled();

    phone.setPermission("granted");
    for (const [type, handler] of addListener.mock.calls as [string, (state: string) => void][]) {
      if (type === "change") {
        handler("active");
      }
    }
    expect(await screen.findByTestId("alerts-device-on")).toBeTruthy();
  });

  it("the question closed without an answer (Android): asks to try again and choose Allow", async () => {
    await renderPanel(fakeTransport(), fakePhone({ answer: "undetermined" }));
    await fireEvent.press(await screen.findByTestId("alerts-device-on"));
    expect(
      await screen.findByText("You closed the question without choosing. Tap the button again and choose Allow."),
    ).toBeTruthy();
  });

  it("no connection for the token: says so, nothing registered, still off", async () => {
    const transport = fakeTransport();
    await renderPanel(transport, fakePhone({ tokenError: new Error("Network request failed") }));
    await fireEvent.press(await screen.findByTestId("alerts-device-on"));
    expect(await screen.findByText("No internet connection. Connect and try again.")).toBeTruthy();
    expect(transport.registerExpoPush).not.toHaveBeenCalled();
    expect(useAlertDeviceStore.getState().deviceOn).toBe(false);
  });

  it("the phone cannot register for push at all: a plain sentence, never a crash", async () => {
    const transport = fakeTransport();
    await renderPanel(
      transport,
      fakePhone({ tokenError: new Error('no valid "aps-environment" entitlement string found for application') }),
    );
    await fireEvent.press(await screen.findByTestId("alerts-device-on"));
    expect(await screen.findByText("That did not work. Check your connection and try again.")).toBeTruthy();
    expect(transport.registerExpoPush).not.toHaveBeenCalled();
  });

  it("ten devices already: says so", async () => {
    const transport = fakeTransport({
      registerExpoPush: jest.fn(() => Promise.reject(new AlertsError("too_many_devices"))),
    });
    await renderPanel(transport, fakePhone());
    await fireEvent.press(await screen.findByTestId("alerts-device-on"));
    expect(await screen.findByText("This account already has alerts on 10 devices. Turn one off first.")).toBeTruthy();
    expect(useAlertDeviceStore.getState().deviceOn).toBe(false);
  });
});

describe("the device list on the phone", () => {
  const devices: AlertDevice[] = [
    { id: PHONE_ID, kind: "expo", endpoint: null, locale: "en", createdAt: Date.UTC(2026, 9, 20), lastOkAt: null, disabled: false },
    {
      id: "44444444-4444-4444-8444-444444444444",
      kind: "expo",
      endpoint: null,
      locale: "ckb",
      createdAt: Date.UTC(2026, 9, 2),
      lastOkAt: null,
      disabled: true,
    },
  ];

  it("marks this phone by its id, words a stopped phone as a phone, and Remove turns alerts off here", async () => {
    useAlertDeviceStore.getState().setPhoneDevice({ token: TOKEN, subscriptionId: PHONE_ID, userId: "user-1", locale: "en" });
    const transport = fakeTransport({ fetchMyDevices: jest.fn(() => Promise.resolve(devices)) });
    await renderPanel(transport, fakePhone({ permission: "granted" }));

    await waitFor(() => expect(screen.getByText("This device")).toBeTruthy());
    expect(screen.getAllByText("Phone app")).toHaveLength(2);
    expect(
      screen.getByText("Stopped: this phone no longer accepts alerts. Turn alerts on again in the app on that phone."),
    ).toBeTruthy();
    expect(screen.queryByText(/this browser no longer accepts alerts/)).toBeNull();
    // The other phone has no endpoint here: removed on that phone.
    expect(screen.queryByTestId("alerts-device-remove-44444444-4444-4444-8444-444444444444")).toBeNull();

    await fireEvent.press(screen.getByTestId(`alerts-device-remove-${PHONE_ID}`));
    await waitFor(() => expect(useAlertDeviceStore.getState().deviceOn).toBe(false));
    expect(transport.unregisterExpoPush).toHaveBeenCalledWith(TOKEN);
  });
});
