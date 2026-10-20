/**
 * Alerts that arrive while the app is open (iOS shows nothing unless the
 * app says so): shown as a banner and in the list, with sound unless the
 * push came without one (the quiet summary), like the web, which always
 * shows them. An upgrade or a newer summary replaces the older one with the
 * same tag, as the web's notification tag does. Never loaded on the web.
 */
import type { Notification } from "expo-notifications";
import { AppState, Platform } from "react-native";

import {
  __resetForegroundHandlerForTests,
  dismissOlderWithSameTag,
  foregroundBehavior,
  installForegroundNotificationHandler,
} from "../foreground-handler";

const mockSetNotificationHandler = jest.fn();
const mockAddReceived = jest.fn();
const mockGetPresented = jest.fn((): Promise<Notification[]> => Promise.resolve([]));
const mockDismiss = jest.fn((_id: string) => Promise.resolve());
let mockLoads = 0;

jest.mock("../notifications-module", () => ({
  requireNotifications: () => {
    mockLoads += 1;
    return {
      setNotificationHandler: mockSetNotificationHandler,
      addNotificationReceivedListener: mockAddReceived,
      getPresentedNotificationsAsync: mockGetPresented,
      dismissNotificationAsync: mockDismiss,
    };
  },
}));

function notification(
  id: string,
  date: number,
  data: Record<string, unknown>,
  sound: string | null = "default",
): Notification {
  return {
    date,
    request: {
      identifier: id,
      content: { title: "M 4.2 earthquake", subtitle: null, body: "x", data, sound } as Notification["request"]["content"],
      trigger: null,
    },
  } as unknown as Notification;
}

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

const originalOS = Platform.OS;

beforeEach(() => {
  __resetForegroundHandlerForTests();
  mockLoads = 0;
  mockSetNotificationHandler.mockClear();
  mockAddReceived.mockClear();
  mockGetPresented.mockClear();
  mockDismiss.mockClear();
});

afterEach(() => {
  Platform.OS = originalOS;
});

describe("foregroundBehavior", () => {
  it("an earthquake alert: banner, list and its sound", () => {
    expect(foregroundBehavior(notification("a", 1, { path: "event/bml2026abcd", tag: "ev-bml2026abcd" }))).toEqual({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    });
  });

  it("the quiet summary (sent without a sound): shown, silent", () => {
    const quiet = notification("s", 1, { path: "event/bml2026abcd", tag: "bml-summary" }, null);
    expect(foregroundBehavior(quiet)).toMatchObject({ shouldShowBanner: true, shouldPlaySound: false });
  });

  it("the local alert rehearsal is shown with its sound too (it used to need the app in the background)", () => {
    expect(foregroundBehavior(notification("r", 1, {}, "default"))).toMatchObject({
      shouldShowBanner: true,
      shouldPlaySound: true,
    });
  });
});

describe("installForegroundNotificationHandler", () => {
  it("sets the handler at once (before anything renders), and only once, on iOS", () => {
    Platform.OS = "ios";
    installForegroundNotificationHandler();
    expect(mockSetNotificationHandler).toHaveBeenCalledTimes(1);
    installForegroundNotificationHandler();
    expect(mockSetNotificationHandler).toHaveBeenCalledTimes(1);
    const handler = mockSetNotificationHandler.mock.calls[0]?.[0] as {
      handleNotification: (n: Notification) => Promise<unknown>;
    };
    return expect(handler.handleNotification(notification("a", 1, { tag: "ev-x" })))
      .resolves.toMatchObject({ shouldShowBanner: true, shouldPlaySound: true })
      .then(() => expect(mockAddReceived).toHaveBeenCalledTimes(1));
  });

  it("never loads expo-notifications on the web", async () => {
    Platform.OS = "web";
    installForegroundNotificationHandler();
    await flush();
    expect(mockLoads).toBe(0);
    expect(mockSetNotificationHandler).not.toHaveBeenCalled();
  });

  it("an upgrade arriving with the app open removes the earlier alert of the same event", async () => {
    Platform.OS = "ios";
    const first = notification("first", 1000, { path: "event/bml2026abcd", tag: "ev-bml2026abcd" });
    const other = notification("other", 1500, { path: "event/bml2026wxyz", tag: "ev-bml2026wxyz" });
    mockGetPresented.mockResolvedValue([first, other]);
    installForegroundNotificationHandler();
    await flush();
    mockDismiss.mockClear();

    const upgrade = notification("upgrade", 2000, { path: "event/bml2026abcd", tag: "ev-bml2026abcd" });
    const onReceived = mockAddReceived.mock.calls[0]?.[0] as (n: Notification) => void;
    onReceived(upgrade);
    await flush();
    expect(mockDismiss).toHaveBeenCalledTimes(1);
    expect(mockDismiss).toHaveBeenCalledWith("first");
    mockGetPresented.mockResolvedValue([]);
  });

  it("back in the app: older duplicates that came while it was closed are tidied", async () => {
    Platform.OS = "ios";
    const addListener = AppState.addEventListener as jest.Mock;
    addListener.mockClear();
    installForegroundNotificationHandler();
    await flush();
    mockGetPresented.mockResolvedValue([
      notification("old", 1000, { tag: "bml-summary" }),
      notification("new", 3000, { tag: "bml-summary" }),
      notification("rehearsal", 500, {}),
    ]);
    mockDismiss.mockClear();
    for (const [type, handler] of addListener.mock.calls as [string, (s: string) => void][]) {
      if (type === "change") {
        handler("active");
      }
    }
    await flush();
    expect(mockDismiss.mock.calls).toEqual([["old"]]);
    mockGetPresented.mockResolvedValue([]);
  });
});

describe("dismissOlderWithSameTag", () => {
  it("keeps the newest per tag and leaves untagged notifications alone", async () => {
    const api = {
      getPresentedNotificationsAsync: jest.fn(() =>
        Promise.resolve([
          notification("t1", 100, { tag: "bml-test" }),
          notification("t2", 300, { tag: "bml-test" }),
          notification("t3", 200, { tag: "bml-test" }),
          notification("plain", 50, {}),
        ]),
      ),
      dismissNotificationAsync: jest.fn((_id: string) => Promise.resolve()),
    };
    await dismissOlderWithSameTag(api);
    expect(api.dismissNotificationAsync.mock.calls.map((call) => call[0]).sort()).toEqual(["t1", "t3"]);
  });
});
