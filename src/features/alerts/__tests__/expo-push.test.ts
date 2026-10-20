/**
 * The phone's push token and project id: no project id means "not in this
 * build" (no crash, no request), a token request that never answers gives
 * up after a while instead of leaving the controls on "One moment..." (an
 * iOS 27 Simulator never answered), and only a real Expo token is accepted.
 */
import { Platform } from "react-native";

import {
  fetchExpoPushToken,
  isExpoPushToken,
  phonePushSupport,
  readEasProjectId,
} from "../expo-push";
import { AlertsError } from "../types";
import { toAlertsError } from "../transport";

const mockGetExpoPushTokenAsync = jest.fn();
jest.mock("@/features/notifications/permissions", () => ({
  loadNotifications: () => Promise.resolve({ getExpoPushTokenAsync: mockGetExpoPushTokenAsync }),
}));

afterEach(() => {
  jest.useRealTimers();
  mockGetExpoPushTokenAsync.mockReset();
});

it("without an EAS project id (today) the phone app has no alerts in this build", () => {
  expect(readEasProjectId()).toBeNull();
  expect(phonePushSupport("ios", null)).toBe("native");
  expect(phonePushSupport("android", null)).toBe("native");
  expect(phonePushSupport("ios", "8a6f0c1e-0000-4000-8000-000000000000")).toBe("supported");
  expect(phonePushSupport("web", "x")).toBe("unsupported");
  expect(Platform.OS).toBe("ios");
});

it("asks Expo for the token with the project id", async () => {
  mockGetExpoPushTokenAsync.mockResolvedValue({ type: "expo", data: "ExponentPushToken[abcdefghij12]" });
  await expect(fetchExpoPushToken("project-1")).resolves.toBe("ExponentPushToken[abcdefghij12]");
  expect(mockGetExpoPushTokenAsync).toHaveBeenCalledWith({ projectId: "project-1" });
});

it("gives up when the registration never answers, with a plain 'did not work'", async () => {
  jest.useFakeTimers();
  mockGetExpoPushTokenAsync.mockReturnValue(new Promise(() => undefined));
  const pending = fetchExpoPushToken("project-1", 20_000);
  const settled = expect(pending).rejects.toThrow(/no answer/);
  await jest.advanceTimersByTimeAsync(20_000);
  await settled;
  const error = await pending.catch((caught: unknown) => caught);
  expect(toAlertsError(error)).toEqual(expect.any(AlertsError));
  expect(toAlertsError(error).code).toBe("unknown");
});

it("refuses anything that is not an Expo push token", async () => {
  mockGetExpoPushTokenAsync.mockResolvedValue({ type: "expo", data: "not a token" });
  await expect(fetchExpoPushToken("project-1")).rejects.toThrow(/unexpected/);
  expect(isExpoPushToken("ExpoPushToken[abcdefghij12]")).toBe(true);
  expect(isExpoPushToken("ExponentPushToken[short]")).toBe(false);
  expect(isExpoPushToken("ExponentPushToken[abc def ghij]")).toBe(false);
  expect(isExpoPushToken(42)).toBe(false);
});
