/**
 * A tapped earthquake alert opens its screen (iOS/Android), as the web's
 * service worker does: the event page for an alert, Notification Settings
 * for the test alert.
 *
 * - cold start: the tap that started the app waits until the app is ready
 *   (settings read, onboarding done), then opens the event page once;
 * - in the background or in front: the tap opens it straight away;
 * - only a plain tap, only our own simple paths, each tap once; the
 *   response is cleared after use, so a reload does not open it again;
 * - a navigator that refuses the first try is tried again;
 * - nothing on the web.
 */
import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { NotificationResponse } from "expo-notifications";
import { Platform } from "react-native";

import { hrefForResponse, useNotificationRouting } from "../use-notification-routing";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
}));

let mockLast: NotificationResponse | null = null;
const mockListeners: ((response: NotificationResponse) => void)[] = [];
const mockClear = jest.fn(() => {
  mockLast = null;
});
let mockLoads = 0;

jest.mock("../permissions", () => ({
  loadNotifications: () => {
    mockLoads += 1;
    return Promise.resolve({
      getLastNotificationResponse: () => mockLast,
      clearLastNotificationResponse: mockClear,
      addNotificationResponseReceivedListener: (listener: (response: NotificationResponse) => void) => {
        mockListeners.push(listener);
        return {
          remove: () => {
            const index = mockListeners.indexOf(listener);
            if (index >= 0) mockListeners.splice(index, 1);
          },
        };
      },
    });
  },
}));

const DEFAULT = "expo.modules.notifications.actions.DEFAULT";

function response(
  id: string,
  data: Record<string, unknown>,
  actionIdentifier: string = DEFAULT,
): NotificationResponse {
  return {
    actionIdentifier,
    notification: {
      date: 1_760_000_000_000,
      request: { identifier: id, content: { title: "M 4.2 earthquake", body: "x", data }, trigger: null },
    },
  } as unknown as NotificationResponse;
}

const EVENT = { pathname: "/event/[id]", params: { id: "bml2026abcd" } };
const originalOS = Platform.OS;

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  mockPush.mockReset();
  mockClear.mockClear();
  mockLast = null;
  mockListeners.length = 0;
  mockLoads = 0;
});

afterEach(() => {
  Platform.OS = originalOS;
});

it("cold start: the tap that opened the app waits for the app to be ready, then opens the event once", async () => {
  mockLast = response("cold", { path: "event/bml2026abcd", tag: "ev-bml2026abcd" });
  const { rerender, unmount } = await renderHook(
    ({ ready }: { ready: boolean }) => useNotificationRouting({ ready }),
    { initialProps: { ready: false } },
  );
  await flush();
  expect(mockPush).not.toHaveBeenCalled();

  await rerender({ ready: true });
  await flush();
  expect(mockPush).toHaveBeenCalledTimes(1);
  expect(mockPush).toHaveBeenCalledWith(EVENT);
  expect(mockClear).toHaveBeenCalledTimes(1);

  // The same response reported again by the listener: not opened twice.
  await act(async () => {
    mockListeners.forEach((listener) => listener(response("cold", { path: "event/bml2026abcd" })));
  });
  await flush();
  expect(mockPush).toHaveBeenCalledTimes(1);
  unmount();
});

it("a tap while the app runs (background or in front) opens the event page at once", async () => {
  const { unmount } = await renderHook(() => useNotificationRouting({ ready: true }));
  await flush();
  expect(mockListeners).toHaveLength(1);

  await act(async () => {
    mockListeners[0]?.(response("warm", { path: "event/bml2026wxyz", tag: "ev-bml2026wxyz" }));
  });
  await waitFor(() =>
    expect(mockPush).toHaveBeenCalledWith({ pathname: "/event/[id]", params: { id: "bml2026wxyz" } }),
  );
  unmount();
});

it("the test alert opens Notification Settings", async () => {
  const { unmount } = await renderHook(() => useNotificationRouting({ ready: true }));
  await flush();
  await act(async () => {
    mockListeners[0]?.(response("test", { path: "notification-settings", tag: "bml-test" }));
  });
  await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/notification-settings"));
  unmount();
});

it("not a plain tap, not ours, or a path off the app: nothing opens", async () => {
  const { unmount } = await renderHook(() => useNotificationRouting({ ready: true }));
  await flush();
  await act(async () => {
    mockListeners[0]?.(
      response("dismissed", { path: "event/bml2026abcd" }, "com.apple.UNNotificationDismissActionIdentifier"),
    );
    mockListeners[0]?.(response("rehearsal", {}));
    mockListeners[0]?.(response("evil", { path: "https://evil.example.com/" }));
  });
  await flush();
  expect(mockPush).not.toHaveBeenCalled();
  unmount();
});

it("a navigator that is not there yet refuses the first try: tried again", async () => {
  mockPush.mockImplementationOnce(() => {
    throw new Error("Attempted to navigate before mounting the Root Layout component.");
  });
  mockLast = response("early", { path: "event/bml2026abcd" });
  const { unmount } = await renderHook(() => useNotificationRouting({ ready: true }));
  await flush();
  await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(2));
  expect(mockPush).toHaveBeenLastCalledWith(EVENT);
  unmount();
});

it("on the web: nothing (the service worker opens the page there)", async () => {
  Platform.OS = "web";
  mockLast = response("web", { path: "event/bml2026abcd" });
  const { unmount } = await renderHook(() => useNotificationRouting({ ready: true }));
  await flush();
  expect(mockLoads).toBe(0);
  expect(mockPush).not.toHaveBeenCalled();
  unmount();
});

it("hrefForResponse reads the tapped notification's data", () => {
  expect(hrefForResponse(response("x", { path: "event/bml2026abcd" }))).toEqual(EVENT);
  expect(hrefForResponse(response("x", { path: "event/bml2026abcd" }, "snooze"))).toBeNull();
});
