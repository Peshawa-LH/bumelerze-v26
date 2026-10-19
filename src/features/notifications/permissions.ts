import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Platform } from "react-native";

export type NotificationPermissionStatus = "granted" | "denied" | "undetermined";

type NotificationsModule = typeof import("expo-notifications");

/**
 * expo-notifications, loaded on first use and never on the web. Merely
 * importing the module subscribes to push-token changes (its
 * DevicePushTokenAutoRegistration side effect), which on the web only prints
 * "[expo-notifications] Listening to push token changes is not yet fully
 * supported on web" on every visit (review B-22); web alerts are web push
 * (features/alerts), and the browser's own Notification API answers the
 * permission questions below.
 */
export async function loadNotifications(): Promise<NotificationsModule | null> {
  if (Platform.OS === "web") {
    return null;
  }
  return import("expo-notifications");
}

/** The permission as expo-notifications and the browser both spell it. */
function toStatus(status: string): NotificationPermissionStatus {
  if (status === "granted") {
    return "granted";
  }
  if (status === "denied") {
    return "denied";
  }
  return "undetermined";
}

interface BrowserNotificationApi {
  permission: string;
  requestPermission?: () => Promise<string>;
}

function browserNotificationApi(): BrowserNotificationApi | null {
  const api = (globalThis as { Notification?: BrowserNotificationApi }).Notification;
  return api && typeof api.permission === "string" ? api : null;
}

/** The current permission, without prompting. */
export async function readNotificationPermission(): Promise<NotificationPermissionStatus> {
  const Notifications = await loadNotifications();
  if (Notifications) {
    const result = await Notifications.getPermissionsAsync();
    return toStatus(result.status);
  }
  return toStatus(browserNotificationApi()?.permission ?? "undetermined");
}

/**
 * Current notification-permission status, re-checked on focus — same
 * "no polling, recheck after returning from system Settings" pattern as
 * `features/location/use-location-permission-status.ts`. Drives the
 * Notification Settings screen's denied-state settings-link row.
 */
export function useNotificationPermissionStatus(): NotificationPermissionStatus {
  const [status, setStatus] = useState<NotificationPermissionStatus>("undetermined");

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;

      readNotificationPermission()
        .then((result) => {
          if (!cancelled) {
            setStatus(result);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setStatus("undetermined");
          }
        });

      return () => {
        cancelled = true;
      };
    }, []),
  );

  return status;
}

/**
 * Requests notification permission if not yet determined, otherwise just
 * reports the current status — never re-prompts a user who already
 * answered (per the platform's own one-shot prompt behavior; a prior
 * "denied" is only reversible from system Settings, which is exactly what
 * the settings-link row is for). Callers ONLY invoke this from a direct
 * user action (a rehearsal button, or moving a tier away from 'off') —
 * the v1 spec §4.11's "ask at the value moment" philosophy, never on
 * screen mount.
 */
export async function ensureNotificationPermission(): Promise<NotificationPermissionStatus> {
  const current = await readNotificationPermission();
  if (current !== "undetermined") {
    return current;
  }
  try {
    const Notifications = await loadNotifications();
    if (Notifications) {
      const requested = await Notifications.requestPermissionsAsync();
      return toStatus(requested.status);
    }
    const api = browserNotificationApi();
    if (api?.requestPermission) {
      return toStatus(await api.requestPermission());
    }
    return "undetermined";
  } catch {
    // Hardware/platform failure — treated as "still undetermined" rather
    // than thrown, matching the offline/failure-state requirement (every
    // native call in this app degrades gracefully, never crashes a screen).
    return "undetermined";
  }
}
