import { Platform } from "react-native";

import i18n from "@/i18n";

import {
  ensureNotificationPermission,
  readNotificationPermission,
} from "../permissions";
import { fireRehearsalNotification, REHEARSAL_VIBRATION_PATTERN } from "../rehearsal";

const mockGetPermissionsAsync = jest.fn();
const mockRequestPermissionsAsync = jest.fn();
const mockScheduleNotificationAsync = jest.fn();
const mockSetNotificationChannelAsync = jest.fn();
let notificationsModuleLoads = 0;

jest.mock("expo-notifications", () => {
  notificationsModuleLoads += 1;
  return {
    PermissionStatus: { GRANTED: "granted", DENIED: "denied", UNDETERMINED: "undetermined" },
    SchedulableTriggerInputTypes: { TIME_INTERVAL: "timeInterval" },
    AndroidImportance: { HIGH: 4 },
    getPermissionsAsync: () => mockGetPermissionsAsync(),
    requestPermissionsAsync: () => mockRequestPermissionsAsync(),
    scheduleNotificationAsync: (...args: unknown[]) => mockScheduleNotificationAsync(...args),
    setNotificationChannelAsync: (...args: unknown[]) =>
      mockSetNotificationChannelAsync(...args),
  };
});

const originalOS = Platform.OS;
function setOS(os: typeof Platform.OS) {
  Object.defineProperty(Platform, "OS", { configurable: true, get: () => os });
}

const browser = globalThis as { Notification?: unknown };

beforeEach(() => {
  jest.clearAllMocks();
  mockGetPermissionsAsync.mockResolvedValue({ status: "undetermined" });
  mockRequestPermissionsAsync.mockResolvedValue({ status: "granted" });
});
afterEach(async () => {
  setOS(originalOS);
  delete browser.Notification;
  await i18n.changeLanguage("en");
});

describe("the Android alert rehearsal channel (review E-8, E-11)", () => {
  it("is named in the app's language and vibrates", async () => {
    setOS("android");
    await i18n.changeLanguage("ckb");
    await fireRehearsalNotification("t", "b");
    expect(mockSetNotificationChannelAsync).toHaveBeenCalledWith(
      "rehearsal",
      expect.objectContaining({
        name: i18n.t("notificationSettings.rehearsal.channelName"),
        enableVibrate: true,
        vibrationPattern: [...REHEARSAL_VIBRATION_PATTERN],
        sound: "default",
      }),
    );
    expect(i18n.t("notificationSettings.rehearsal.channelName")).not.toBe("Alert rehearsal");
    expect(mockScheduleNotificationAsync).toHaveBeenCalledTimes(1);
  });

  it("iOS needs no channel and still schedules the notification", async () => {
    setOS("ios");
    await fireRehearsalNotification("t", "b");
    expect(mockSetNotificationChannelAsync).not.toHaveBeenCalled();
    expect(mockScheduleNotificationAsync).toHaveBeenCalledWith(
      expect.objectContaining({ content: { title: "t", body: "b", sound: "default" } }),
    );
  });
});

describe("on the web expo-notifications is never loaded (review B-22)", () => {
  beforeEach(() => setOS("web"));

  it("the rehearsal does nothing", async () => {
    const before = notificationsModuleLoads;
    await fireRehearsalNotification("t", "b");
    expect(mockScheduleNotificationAsync).not.toHaveBeenCalled();
    expect(notificationsModuleLoads).toBe(before);
  });

  it("the permission comes from the browser's Notification API", async () => {
    browser.Notification = { permission: "denied" };
    expect(await readNotificationPermission()).toBe("denied");
    browser.Notification = { permission: "default" };
    expect(await readNotificationPermission()).toBe("undetermined");
    expect(mockGetPermissionsAsync).not.toHaveBeenCalled();
  });

  it("asks the browser when undetermined, and only then", async () => {
    const requestPermission = jest.fn(async () => "granted");
    browser.Notification = { permission: "default", requestPermission };
    expect(await ensureNotificationPermission()).toBe("granted");
    expect(requestPermission).toHaveBeenCalledTimes(1);

    browser.Notification = { permission: "granted", requestPermission };
    expect(await ensureNotificationPermission()).toBe("granted");
    expect(requestPermission).toHaveBeenCalledTimes(1);
  });

  it("a browser without the API is simply undetermined", async () => {
    expect(await readNotificationPermission()).toBe("undetermined");
    expect(await ensureNotificationPermission()).toBe("undetermined");
  });
});

describe("on the phone the permission goes through expo-notifications", () => {
  it("reads, then requests only when undetermined", async () => {
    setOS("ios");
    expect(await ensureNotificationPermission()).toBe("granted");
    expect(mockRequestPermissionsAsync).toHaveBeenCalledTimes(1);
    mockGetPermissionsAsync.mockResolvedValue({ status: "denied" });
    expect(await ensureNotificationPermission()).toBe("denied");
    expect(mockRequestPermissionsAsync).toHaveBeenCalledTimes(1);
  });
});
