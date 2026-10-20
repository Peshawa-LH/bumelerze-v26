import type { NotificationResponse } from "expo-notifications";
import { useRouter, type Href } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Platform } from "react-native";

import { hrefForAlertPath, readAlertData } from "./alert-data";
import { loadNotifications } from "./permissions";

/**
 * iOS/Android: opens the right screen when the person taps an earthquake
 * alert notification, as the web's service worker does (public/push-sw.js,
 * `notificationclick`): the event page for an alert, update or summary,
 * Notification Settings for the test alert.
 *
 * Covers the three cases: a tap that started the app (cold start: the
 * response waits in expo-notifications and is read once the module is
 * loaded), a tap while the app was in the background, and a tap on a banner
 * while the app is in front. The screen opens only once `ready` (settings
 * read, onboarding done, no restart under way) and the navigator accepts
 * it; a tap that arrives earlier waits for it. Each tap opens its
 * screen once; after that the response is cleared, so a later reload of
 * the JavaScript (an update, a language restart) does not open it again.
 *
 * Mounted from app/_layout.tsx; nothing on the web.
 */
export interface NotificationRoutingOptions {
  /** True once a screen can be opened: settings read, onboarding done and
   * no restart under way. A tap that arrives earlier waits for it. */
  ready: boolean;
}

/** expo-notifications' id for a plain tap on the notification. */
const DEFAULT_ACTION = "expo.modules.notifications.actions.DEFAULT";

/** The screen a tap on this notification opens, or null (not ours, or not
 * a plain tap). */
export function hrefForResponse(response: NotificationResponse): Href | null {
  if (response.actionIdentifier !== DEFAULT_ACTION) {
    return null;
  }
  return hrefForAlertPath(readAlertData(response.notification.request.content.data).path);
}

function responseKey(response: NotificationResponse): string {
  return `${response.notification.request.identifier}:${response.notification.date}`;
}

export function useNotificationRouting({ ready }: NotificationRoutingOptions): void {
  const router = useRouter();
  // The screen waiting to open, and a counter that wakes the effect below
  // (a new tap, or another try after the navigator refused one).
  const pending = useRef<Href | null>(null);
  const attempts = useRef(0);
  const [wake, setWake] = useState(0);
  const seen = useRef(new Set<string>());
  const clear = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (Platform.OS === "web") {
      return;
    }
    let cancelled = false;
    let subscription: { remove?: () => void } | null = null;
    const take = (response: NotificationResponse | null) => {
      if (!response || cancelled) {
        return;
      }
      const key = responseKey(response);
      if (seen.current.has(key)) {
        return;
      }
      seen.current.add(key);
      const href = hrefForResponse(response);
      if (href) {
        pending.current = href;
        attempts.current = 0;
        setWake((n) => n + 1);
      }
    };
    void loadNotifications()
      .then((Notifications) => {
        if (!Notifications || cancelled) {
          return;
        }
        clear.current = () => Notifications.clearLastNotificationResponse();
        take(Notifications.getLastNotificationResponse());
        subscription = Notifications.addNotificationResponseReceivedListener(take);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      subscription?.remove?.();
    };
  }, []);

  useEffect(() => {
    const href = pending.current;
    if (!href || !ready) {
      return;
    }
    try {
      router.push(href);
    } catch {
      // A navigator that is not quite there yet (the first frames after a
      // cold start) refuses the push: tried again shortly, for a few seconds.
      attempts.current += 1;
      if (attempts.current > MAX_ATTEMPTS) {
        pending.current = null;
        return;
      }
      const timer = setTimeout(() => setWake((n) => n + 1), RETRY_MS);
      return () => clearTimeout(timer);
    }
    pending.current = null;
    try {
      clear.current?.();
    } catch {
      // Nothing left to clear.
    }
    return undefined;
  }, [ready, router, wake]);
}

const RETRY_MS = 250;
const MAX_ATTEMPTS = 20;
