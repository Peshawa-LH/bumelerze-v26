/**
 * The phone's registration kept in step with the phone (iOS/Android), the
 * way the web repairs its browser subscription:
 *
 * - nothing at all (no request) while alerts are off here;
 * - notifications turned off in Settings: the phone leaves the server;
 * - a new push token, a new app language: registered again, the old token
 *   removed;
 * - a sign-in as another account that may have alerts: the phone moves to
 *   it and the alert places are saved again for it;
 * - a sign-out (testers only: the new anonymous user may not have alerts):
 *   the phone is released from the old account and alerts turn off here,
 *   so nobody receives another person's alerts on a shared phone;
 * - offline: everything stays as it was and is tried again; a removal that
 *   could not be sent is owed and sent later;
 * - mounted at the root: runs on launch, on return to the app and when the
 *   token changes, never on the web.
 */
import { act, renderHook, waitFor } from "@testing-library/react-native";
import { AppState, Platform } from "react-native";

import { useAccountStore } from "@/features/account/store";

import {
  requestPhoneSync,
  syncPhoneAlerts,
  usePhoneAlertSync,
  type PhoneSyncDeps,
} from "../phone-sync";
import { useAlertDeviceStore } from "../store";
import type { AlertsTransport } from "../transport";
import { AlertsError } from "../types";
import type { BrowserPermission } from "../web-push";

jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  getSupabaseClient: () => null,
  signInAnonymously: () => Promise.resolve(),
}));

const mockTokenListeners: (() => void)[] = [];
jest.mock("@/features/notifications/permissions", () => ({
  loadNotifications: () =>
    Promise.resolve({
      addPushTokenListener: (listener: () => void) => {
        mockTokenListeners.push(listener);
        return { remove: jest.fn() };
      },
    }),
}));

// The hook builds its own dependencies: a project id and a token from Expo.
const mockFetchToken = jest.fn((_projectId: string) => Promise.resolve("ExponentPushToken[old-token-12345]"));
jest.mock("../expo-push", () => ({
  ...jest.requireActual("../expo-push"),
  readEasProjectId: () => "project-1",
  readPhonePermission: () => Promise.resolve("granted"),
  fetchExpoPushToken: (projectId: string) => mockFetchToken(projectId),
  ensureAlertChannels: () => Promise.resolve(),
}));

jest.mock("@/features/account/store", () => {
  const { create } = jest.requireActual("zustand");
  return {
    useAccountStore: create(() => ({ status: "anonymous", userId: null })),
    ensureAccountSync: jest.fn(),
  };
});

const OLD = "ExponentPushToken[old-token-12345]";
const NEW = "ExponentPushToken[new-token-67890]";
const ID_A = "11111111-1111-4111-8111-111111111111";
const ID_B = "22222222-2222-4222-8222-222222222222";

function fakeTransport(over: Partial<AlertsTransport> = {}): jest.Mocked<AlertsTransport> {
  return {
    fetchAccess: jest.fn(),
    registerWebPush: jest.fn(),
    unregisterWebPush: jest.fn(),
    registerExpoPush: jest.fn(() => Promise.resolve(ID_B)),
    unregisterExpoPush: jest.fn(() => Promise.resolve()),
    releaseExpoPush: jest.fn(() => Promise.resolve()),
    fetchMyDevices: jest.fn(),
    savePreferences: jest.fn(() => Promise.resolve()),
    sendTest: jest.fn(),
    fetchOverview: jest.fn(),
    setMode: jest.fn(),
    addTester: jest.fn(),
    removeTester: jest.fn(),
    ...over,
  } as jest.Mocked<AlertsTransport>;
}

function deps(
  transport: AlertsTransport,
  over: Partial<Omit<PhoneSyncDeps, "transport">> = {},
): PhoneSyncDeps & { fetchToken: jest.Mock; ensureChannels: jest.Mock; readPermission: jest.Mock } {
  return {
    transport,
    projectId: "project-1",
    readPermission: jest.fn((): Promise<BrowserPermission | null> => Promise.resolve("granted")),
    fetchToken: jest.fn(() => Promise.resolve(OLD)),
    ensureChannels: jest.fn(() => Promise.resolve()),
    ...over,
  } as PhoneSyncDeps & { fetchToken: jest.Mock; ensureChannels: jest.Mock; readPermission: jest.Mock };
}

function phoneOn(userId = "user-a", locale = "en") {
  useAlertDeviceStore.getState().setPhoneDevice({ token: OLD, subscriptionId: ID_A, userId, locale });
  useAlertDeviceStore.getState().setSyncedKey("synced");
}

beforeEach(() => {
  useAlertDeviceStore.getState().setPhoneDevice(null);
  useAlertDeviceStore.getState().setPendingRemoval(null);
  useAccountStore.setState({ userId: null });
  mockTokenListeners.length = 0;
});

describe("syncPhoneAlerts", () => {
  it("alerts off here and nothing owed: no request at all", async () => {
    const transport = fakeTransport();
    const d = deps(transport);
    await syncPhoneAlerts(d, { locale: "en", userId: "user-a" });
    expect(d.readPermission).not.toHaveBeenCalled();
    expect(d.fetchToken).not.toHaveBeenCalled();
    expect(transport.registerExpoPush).not.toHaveBeenCalled();
  });

  it("a build without a project id cannot check anything: leaves it all alone", async () => {
    phoneOn();
    const transport = fakeTransport();
    const d = deps(transport, { projectId: null });
    await syncPhoneAlerts(d, { locale: "ckb", userId: "user-a" });
    expect(d.fetchToken).not.toHaveBeenCalled();
    expect(transport.registerExpoPush).not.toHaveBeenCalled();
    expect(useAlertDeviceStore.getState().deviceOn).toBe(true);
  });

  it("nothing changed: no registration, only the Android channel names", async () => {
    phoneOn();
    const transport = fakeTransport();
    const d = deps(transport);
    await syncPhoneAlerts(d, { locale: "en", userId: "user-a" });
    expect(transport.registerExpoPush).not.toHaveBeenCalled();
    expect(d.ensureChannels).toHaveBeenCalledTimes(1);
  });

  it("notifications turned off in Settings: the phone leaves the server and alerts are off here", async () => {
    phoneOn();
    const transport = fakeTransport();
    await syncPhoneAlerts(deps(transport, { readPermission: jest.fn(() => Promise.resolve("denied")) }), {
      locale: "en",
      userId: "user-a",
    });
    expect(transport.unregisterExpoPush).toHaveBeenCalledWith(OLD);
    expect(useAlertDeviceStore.getState()).toMatchObject({ deviceOn: false, expoToken: null, syncedKey: null });
  });

  it("turned off in Settings before the session is back: the removal is owed, then sent", async () => {
    phoneOn();
    const transport = fakeTransport();
    await syncPhoneAlerts(deps(transport, { readPermission: jest.fn(() => Promise.resolve("denied")) }), {
      locale: "en",
      userId: null,
    });
    expect(transport.unregisterExpoPush).not.toHaveBeenCalled();
    expect(useAlertDeviceStore.getState().pendingRemoval).toBe(OLD);

    await syncPhoneAlerts(deps(transport), { locale: "en", userId: "user-a" });
    expect(transport.releaseExpoPush).toHaveBeenCalledWith(OLD);
    expect(useAlertDeviceStore.getState().pendingRemoval).toBeNull();
  });

  it("a new push token: registered in the app language, the old one removed", async () => {
    phoneOn();
    const transport = fakeTransport();
    await syncPhoneAlerts(deps(transport, { fetchToken: jest.fn(() => Promise.resolve(NEW)) }), {
      locale: "en",
      userId: "user-a",
    });
    expect(transport.registerExpoPush).toHaveBeenCalledWith(NEW, "en");
    expect(transport.unregisterExpoPush).toHaveBeenCalledWith(OLD);
    expect(useAlertDeviceStore.getState()).toMatchObject({
      deviceOn: true,
      expoToken: NEW,
      subscriptionId: ID_B,
      userId: "user-a",
    });
  });

  it("the app language changed: registered again so alerts come in Sorani", async () => {
    phoneOn("user-a", "en");
    const transport = fakeTransport({ registerExpoPush: jest.fn(() => Promise.resolve(ID_A)) });
    await syncPhoneAlerts(deps(transport), { locale: "ckb", userId: "user-a" });
    expect(transport.registerExpoPush).toHaveBeenCalledWith(OLD, "ckb");
    expect(transport.unregisterExpoPush).not.toHaveBeenCalled();
    expect(useAlertDeviceStore.getState()).toMatchObject({ locale: "ckb", syncedKey: "synced" });
  });

  it("signed in as another account that has alerts: the phone moves to it, its places are saved again", async () => {
    phoneOn("user-a");
    const transport = fakeTransport();
    await syncPhoneAlerts(deps(transport), { locale: "en", userId: "user-b" });
    expect(transport.registerExpoPush).toHaveBeenCalledWith(OLD, "en");
    expect(transport.releaseExpoPush).not.toHaveBeenCalled();
    expect(useAlertDeviceStore.getState()).toMatchObject({
      deviceOn: true,
      userId: "user-b",
      subscriptionId: ID_B,
      syncedKey: null,
    });
  });

  it("signed out (the new anonymous user may not have alerts): released from the old account, off here", async () => {
    phoneOn("user-a");
    const transport = fakeTransport({
      registerExpoPush: jest.fn(() =>
        Promise.reject(new AlertsError("not_enabled", "alerts_register_expo_push: not_enabled")),
      ),
    });
    await syncPhoneAlerts(deps(transport), { locale: "en", userId: "anon-1" });
    expect(transport.releaseExpoPush).toHaveBeenCalledWith(OLD);
    expect(useAlertDeviceStore.getState()).toMatchObject({ deviceOn: false, expoToken: null, userId: null });
    expect(useAlertDeviceStore.getState().pendingRemoval).toBeNull();
  });

  it("signed out before migration 0068 is live: falls back to the owner call and still turns off", async () => {
    phoneOn("user-a");
    const transport = fakeTransport({
      registerExpoPush: jest.fn(() => Promise.reject(new AlertsError("not_enabled"))),
      releaseExpoPush: jest.fn(() => Promise.reject(new AlertsError("unavailable"))),
    });
    await syncPhoneAlerts(deps(transport), { locale: "en", userId: "anon-1" });
    expect(transport.unregisterExpoPush).toHaveBeenCalledWith(OLD);
    expect(useAlertDeviceStore.getState().deviceOn).toBe(false);
  });

  it("the same account is no longer a tester: removed as its owner, off here", async () => {
    phoneOn("user-a", "en");
    const transport = fakeTransport({
      registerExpoPush: jest.fn(() => Promise.reject(new AlertsError("not_enabled"))),
    });
    await syncPhoneAlerts(deps(transport), { locale: "ckb", userId: "user-a" });
    expect(transport.unregisterExpoPush).toHaveBeenCalledWith(OLD);
    expect(transport.releaseExpoPush).not.toHaveBeenCalled();
    expect(useAlertDeviceStore.getState().deviceOn).toBe(false);
  });

  it("offline: the token check and the registration fail, everything stays as it was", async () => {
    phoneOn("user-a", "en");
    const transport = fakeTransport({
      registerExpoPush: jest.fn(() => Promise.reject(new AlertsError("network"))),
    });
    const d = deps(transport, { fetchToken: jest.fn(() => Promise.reject(new Error("Network request failed"))) });
    await syncPhoneAlerts(d, { locale: "ckb", userId: "user-a" });
    expect(transport.registerExpoPush).toHaveBeenCalledWith(OLD, "ckb");
    expect(useAlertDeviceStore.getState()).toMatchObject({ deviceOn: true, expoToken: OLD, locale: "en" });
  });

  it("no session yet: nothing is registered", async () => {
    phoneOn("user-a", "en");
    const transport = fakeTransport();
    await syncPhoneAlerts(deps(transport), { locale: "ckb", userId: null });
    expect(transport.registerExpoPush).not.toHaveBeenCalled();
    expect(useAlertDeviceStore.getState().deviceOn).toBe(true);
  });

  it("a removal owed from an offline Turn off is sent once online, and stays owed while offline", async () => {
    useAlertDeviceStore.getState().setPendingRemoval(OLD);
    const offline = fakeTransport({ releaseExpoPush: jest.fn(() => Promise.reject(new AlertsError("network"))) });
    await syncPhoneAlerts(deps(offline), { locale: "en", userId: "user-a" });
    expect(useAlertDeviceStore.getState().pendingRemoval).toBe(OLD);

    const online = fakeTransport();
    await syncPhoneAlerts(deps(online), { locale: "en", userId: "user-a" });
    expect(online.releaseExpoPush).toHaveBeenCalledWith(OLD);
    expect(useAlertDeviceStore.getState().pendingRemoval).toBeNull();
  });
});

describe("requestPhoneSync", () => {
  it("never runs two passes at once: a request during a pass gives one more pass, with the newest language", async () => {
    phoneOn("user-a", "en");
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const transport = fakeTransport({
      registerExpoPush: jest.fn(async () => {
        await gate;
        return ID_A;
      }),
    });
    let locale = "ckb";
    const d = deps(transport);
    const first = requestPhoneSync(() => d, () => ({ locale, userId: "user-a" }));
    await Promise.resolve();
    locale = "ar";
    void requestPhoneSync(() => d, () => ({ locale, userId: "user-a" }));
    void requestPhoneSync(() => d, () => ({ locale, userId: "user-a" }));
    release();
    await first;
    expect(transport.registerExpoPush.mock.calls.map((call) => call[1])).toEqual(["ckb", "ar"]);
  });
});

describe("usePhoneAlertSync (mounted at the root)", () => {
  const originalOS = Platform.OS;
  afterEach(() => {
    Platform.OS = originalOS;
  });

  /** React Native's Jest setup already mocks AppState: the "change"
   * listeners registered since this call. */
  function captureAppState(): () => ((state: string) => void)[] {
    const addListener = AppState.addEventListener as jest.Mock;
    addListener.mockClear();
    return () =>
      (addListener.mock.calls as [string, (state: string) => void][])
        .filter(([type]) => type === "change")
        .map(([, handler]) => handler);
  }

  it("on the web: never starts (no session listener, no listeners, no request)", async () => {
    Platform.OS = "web";
    phoneOn();
    const handlers = captureAppState();
    const transport = fakeTransport();
    const { unmount } = await renderHook(() => usePhoneAlertSync("ckb", transport));
    await act(async () => {
      await Promise.resolve();
    });
    expect(handlers()).toHaveLength(0);
    expect(mockTokenListeners).toHaveLength(0);
    expect(transport.registerExpoPush).not.toHaveBeenCalled();
    unmount();
  });

  it("with alerts off on the phone: nothing at all", async () => {
    const handlers = captureAppState();
    const transport = fakeTransport();
    const { unmount } = await renderHook(() => usePhoneAlertSync("ckb", transport));
    await act(async () => {
      await Promise.resolve();
    });
    expect(handlers()).toHaveLength(0);
    expect(transport.registerExpoPush).not.toHaveBeenCalled();
    unmount();
  });

  async function settle() {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  it("on the phone with alerts on: checks on launch, on return to the app and when the token changes", async () => {
    phoneOn("user-a", "en");
    useAccountStore.setState({ userId: "user-a" });
    mockFetchToken.mockClear();
    const handlers = captureAppState();
    const transport = fakeTransport({ registerExpoPush: jest.fn(() => Promise.resolve(ID_A)) });
    const { unmount } = await renderHook(() => usePhoneAlertSync("ckb", transport));
    // Launch: the app language is Sorani now, so the phone registers again.
    await waitFor(() => expect(transport.registerExpoPush).toHaveBeenCalledWith(OLD, "ckb"));
    await waitFor(() => expect(useAlertDeviceStore.getState().locale).toBe("ckb"));
    await settle();
    const launchChecks = mockFetchToken.mock.calls.length;
    expect(launchChecks).toBeGreaterThanOrEqual(1);
    expect(handlers().length).toBeGreaterThanOrEqual(1);
    expect(mockTokenListeners.length).toBeGreaterThanOrEqual(1);

    // Back from the background: checked again (nothing to change).
    handlers().forEach((handler) => handler("active"));
    await waitFor(() => expect(mockFetchToken.mock.calls.length).toBeGreaterThan(launchChecks));
    await settle();

    // Apple handed out a new token: registered, the old one removed.
    mockFetchToken.mockResolvedValue(NEW);
    mockTokenListeners.forEach((listener) => listener());
    await waitFor(() => expect(transport.registerExpoPush).toHaveBeenLastCalledWith(NEW, "ckb"));
    await waitFor(() => expect(transport.unregisterExpoPush).toHaveBeenCalledWith(OLD));
    mockFetchToken.mockResolvedValue(OLD);
    unmount();
  });

  it("after a sign-out the new session's user triggers the check (released, off)", async () => {
    phoneOn("user-a", "en");
    useAccountStore.setState({ userId: "user-a" });
    captureAppState();
    const transport = fakeTransport({
      registerExpoPush: jest.fn(() => Promise.reject(new AlertsError("not_enabled"))),
    });
    const { unmount } = await renderHook(() => usePhoneAlertSync("en", transport));
    await settle();
    expect(transport.registerExpoPush).not.toHaveBeenCalled();

    await act(async () => {
      useAccountStore.setState({ userId: null });
    });
    await act(async () => {
      useAccountStore.setState({ userId: "anon-1" });
    });
    await waitFor(() => expect(transport.releaseExpoPush).toHaveBeenCalledWith(OLD));
    await waitFor(() => expect(useAlertDeviceStore.getState().deviceOn).toBe(false));
    unmount();
  });
});
