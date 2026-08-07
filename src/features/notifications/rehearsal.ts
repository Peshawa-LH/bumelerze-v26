import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

/** Matches spec-v1.md §4.10's rehearsal requirement ("Play Alert Sound") —
 * long enough that a user who taps the button has time to read the
 * background-the-app hint and press the home button before it fires. */
export const REHEARSAL_DELAY_SECONDS = 2;

const REHEARSAL_CHANNEL_ID = "rehearsal";

/**
 * Fires a REAL local notification (no push token, no server — entirely
 * on-device) so the user can see and hear exactly what a future alert will
 * look/sound like. Android requires a notification channel to exist before
 * scheduling; creating it here is idempotent (re-creating the same
 * channel id is a harmless no-op) so callers never need their own
 * one-time-setup step.
 */
export async function fireRehearsalNotification(
  title: string,
  body: string,
): Promise<void> {
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync(REHEARSAL_CHANNEL_ID, {
      name: "Alert rehearsal",
      importance: Notifications.AndroidImportance.HIGH,
      sound: "default",
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
}
