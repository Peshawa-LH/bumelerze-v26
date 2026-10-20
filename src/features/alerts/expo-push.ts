import Constants from "expo-constants";
import { Platform } from "react-native";

import { loadNotifications } from "@/features/notifications/permissions";
import i18n from "@/i18n";

import type { BrowserPermission, WebPushSupport } from "./web-push";

/**
 * The phone side of alerts (iOS/Android, Expo push; migration 0062 accepts
 * `kind = 'expo'`). The send-alerts edge function sends to the Expo push
 * API, which hands the alert to Apple (APNs) or Google (FCM). Nothing here
 * runs on the web: `loadNotifications` returns null there.
 */

/**
 * The EAS project id this build was made with: app.config.ts writes it from
 * EAS_PROJECT_ID, and EAS builds also carry it in `easConfig`. Until the
 * Expo account exists there is none, and a phone cannot get a push token.
 */
export function readEasProjectId(): string | null {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: unknown } } | undefined;
  const candidates: unknown[] = [extra?.eas?.projectId, Constants.easConfig?.projectId];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

/**
 * Whether this phone app can have alerts at all: "supported" with a
 * project id, else "native" (the panel then says alerts come with the
 * app's next version, the words it has always used for the phone app).
 */
export function phonePushSupport(platformOS: string, projectId: string | null): WebPushSupport {
  if (platformOS === "web") {
    return "unsupported";
  }
  return projectId ? "supported" : "native";
}

/** iOS/Android with a project id: the alert controls can register this
 * phone (and show their own blocked state with an Open Settings button). */
export function phoneAlertsAvailable(): boolean {
  return phonePushSupport(Platform.OS, readEasProjectId()) === "supported";
}

/** The same check the server makes (alerts_register_expo_push). */
const EXPO_TOKEN = /^Expo(nent)?PushToken\[[A-Za-z0-9_-]{10,100}\]$/;

export function isExpoPushToken(value: unknown): value is string {
  return typeof value === "string" && EXPO_TOKEN.test(value);
}

/** The phone's notification permission, in the browser's words. */
export async function readPhonePermission(): Promise<BrowserPermission | null> {
  const Notifications = await loadNotifications();
  if (!Notifications) {
    return null;
  }
  const result = await Notifications.getPermissionsAsync();
  if (result.status === "granted") {
    return "granted";
  }
  if (result.status === "denied") {
    return "denied";
  }
  return "default";
}

/** How long the token may take: Apple's (or Google's) registration, then a
 * request to Expo's servers. */
export const PUSH_TOKEN_TIMEOUT_MS = 20_000;

/**
 * This phone's Expo push token (a request to Expo's servers, which needs
 * the APNs/FCM registration underneath). Throws when there is no project
 * id, no connection, or the build cannot register for push, and after
 * `PUSH_TOKEN_TIMEOUT_MS` without an answer: the iOS registration can stay
 * silent for good (an iOS 27 Simulator never answered, 2026-10-21), and
 * neither the alert controls ("One moment...") nor the root sync may wait
 * forever.
 */
export async function fetchExpoPushToken(
  projectId: string,
  timeoutMs: number = PUSH_TOKEN_TIMEOUT_MS,
): Promise<string> {
  const Notifications = await loadNotifications();
  if (!Notifications) {
    throw new Error("expo-notifications is not available here");
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error("push token: no answer from the phone's push registration")),
      timeoutMs,
    );
  });
  try {
    const result = await Promise.race([Notifications.getExpoPushTokenAsync({ projectId }), timeout]);
    if (!isExpoPushToken(result.data)) {
      throw new Error("unexpected Expo push token");
    }
    return result.data;
  } finally {
    clearTimeout(timer);
  }
}

/** The Android channels send-alerts names (senders.ts `channelId`). */
export const ALERT_CHANNEL_ID = "alerts";
export const QUIET_CHANNEL_ID = "alerts-quiet";

/**
 * Android: the two channels the server sends to, named in the app's
 * language (Android shows these names in the app's notification settings).
 * Earthquake alerts ring and show on screen; the quiet channel (the
 * aftershock summary) makes no sound, as on the web. Creating a channel
 * again only updates its name. Nothing on iOS.
 */
export async function ensureAlertChannels(): Promise<void> {
  if (Platform.OS !== "android") {
    return;
  }
  const Notifications = await loadNotifications();
  if (!Notifications) {
    return;
  }
  await Notifications.setNotificationChannelAsync(ALERT_CHANNEL_ID, {
    name: i18n.t("alerts.channels.alerts"),
    importance: Notifications.AndroidImportance.HIGH,
    sound: "default",
    enableVibrate: true,
  });
  await Notifications.setNotificationChannelAsync(QUIET_CHANNEL_ID, {
    name: i18n.t("alerts.channels.quiet"),
    importance: Notifications.AndroidImportance.LOW,
    sound: null,
    enableVibrate: false,
  });
}
