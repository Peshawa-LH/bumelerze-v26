import type { Notification, NotificationBehavior } from "expo-notifications";
import { AppState, Platform } from "react-native";

import { readAlertData } from "./alert-data";
import { requireNotifications, type NotificationsModule } from "./notifications-module";

/**
 * iOS/Android: how a notification that arrives while the app is open is
 * shown. iOS shows nothing for it unless the app says so; the web always
 * shows an alert, open or not (public/push-sw.js). So: a banner and an
 * entry in the notification list for every notification (earthquake
 * alerts, the test alert, the local alert rehearsal), with its sound unless
 * it came without one (the quiet aftershock summary).
 */
export function foregroundBehavior(notification: Notification): NotificationBehavior {
  const sound = notification.request.content.sound;
  return {
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: sound !== null && sound !== undefined,
    shouldSetBadge: false,
  };
}

/**
 * An alert whose magnitude was revised (an "upgrade") or a newer summary
 * carries the same `tag` as the one already in the notification list. The
 * web replaces the older notification by its tag; the Expo push service has
 * no such key, so the app removes the older ones itself while it runs: when
 * the newer one arrives with the app open, and whenever the app comes back
 * to the foreground.
 */
export async function dismissOlderWithSameTag(
  Notifications: Pick<NotificationsModule, "getPresentedNotificationsAsync" | "dismissNotificationAsync">,
  newest?: Notification,
): Promise<void> {
  const presented = await Notifications.getPresentedNotificationsAsync();
  const keep = new Map<string, Notification>();
  for (const item of newest ? [...presented, newest] : presented) {
    const { tag } = readAlertData(item.request.content.data);
    if (!tag) {
      continue;
    }
    const current = keep.get(tag);
    if (!current || item === newest || (current !== newest && item.date > current.date)) {
      keep.set(tag, item);
    }
  }
  for (const item of presented) {
    const { tag } = readAlertData(item.request.content.data);
    const winner = tag ? keep.get(tag) : undefined;
    if (winner && winner.request.identifier !== item.request.identifier) {
      await Notifications.dismissNotificationAsync(item.request.identifier).catch(() => undefined);
    }
  }
}

let installed = false;

/**
 * Called once when app/_layout.tsx loads, before anything renders, so the
 * handler is in place before the first notification can arrive. Loads
 * expo-notifications only on iOS/Android (never on the web: importing it
 * there starts its push-token listener, review B-22).
 */
export function installForegroundNotificationHandler(): void {
  if (Platform.OS === "web" || installed) {
    return;
  }
  let Notifications: NotificationsModule | null;
  try {
    Notifications = requireNotifications();
  } catch {
    // The module could not load (not expected in a built app): alerts still
    // show while the app is closed; the next launch tries again.
    return;
  }
  if (!Notifications) {
    return;
  }
  installed = true;
  const api = Notifications;
  api.setNotificationHandler({
    handleNotification: async (notification) => foregroundBehavior(notification),
  });
  const tidy = (newest?: Notification) => {
    void dismissOlderWithSameTag(api, newest).catch(() => undefined);
  };
  api.addNotificationReceivedListener((notification) => tidy(notification));
  AppState.addEventListener("change", (state) => {
    if (state === "active") {
      tidy();
    }
  });
  tidy();
}

/** Test-only: forget that the handler was installed. */
export function __resetForegroundHandlerForTests(): void {
  installed = false;
}
