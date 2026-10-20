import { Platform } from "react-native";

import i18n from "@/i18n";

import { loadNotifications } from "./permissions";

/** Matches the v1 spec §4.10's rehearsal requirement ("Play Alert Sound") —
 * long enough that a user who taps the button has time to read the
 * background-the-app hint and press the home button before it fires. */
export const REHEARSAL_DELAY_SECONDS = 2;

const REHEARSAL_CHANNEL_ID = "rehearsal";

/** Android: two short pulses (wait, buzz, wait, buzz, in ms) — noticed in a
 * pocket without reading as an emergency siren (review E-11). */
export const REHEARSAL_VIBRATION_PATTERN: readonly number[] = [0, 250, 250, 250];

/**
 * Fires a REAL local notification (no push token, no server — entirely
 * on-device) so the user can see and hear exactly what a future alert will
 * look/sound like. Android requires a notification channel to exist before
 * scheduling; creating it here is idempotent (re-creating the same
 * channel id is a harmless no-op) so callers never need their own
 * one-time-setup step. The channel's name is what Android shows in the
 * app's notification settings, in the app's language (review E-8).
 *
 * The web has no scheduled notifications (and `loadNotifications` returns
 * nothing there); the screen does not offer this button on the web.
 *
 * Resolves false, never rejects, when the phone refuses to schedule it (an
 * iOS 27 Simulator answered ERR_NOTIFICATIONS_FAILED_TO_SCHEDULE, 2026-10-21):
 * the button simply does nothing, instead of an unhandled error.
 */
export async function fireRehearsalNotification(
  title: string,
  body: string,
): Promise<boolean> {
  const Notifications = await loadNotifications();
  if (!Notifications) {
    return false;
  }
  try {
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync(REHEARSAL_CHANNEL_ID, {
        name: i18n.t("notificationSettings.rehearsal.channelName"),
        importance: Notifications.AndroidImportance.HIGH,
        sound: "default",
        enableVibrate: true,
        vibrationPattern: [...REHEARSAL_VIBRATION_PATTERN],
      });
    }

    await Notifications.scheduleNotificationAsync({
      content: { title, body, sound: "default" },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: REHEARSAL_DELAY_SECONDS,
        channelId: REHEARSAL_CHANNEL_ID,
      },
    });
    return true;
  } catch {
    return false;
  }
}
