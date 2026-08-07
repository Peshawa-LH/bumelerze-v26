import { useFocusEffect } from "expo-router";
import * as Notifications from "expo-notifications";
import { useCallback, useState } from "react";

export type NotificationPermissionStatus = "granted" | "denied" | "undetermined";

function toStatus(status: Notifications.PermissionStatus): NotificationPermissionStatus {
  if (status === Notifications.PermissionStatus.GRANTED) {
    return "granted";
  }
  if (status === Notifications.PermissionStatus.DENIED) {
    return "denied";
  }
  return "undetermined";
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

      Notifications.getPermissionsAsync()
        .then((result) => {
          if (!cancelled) {
            setStatus(toStatus(result.status));
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
 * spec-v1.md §4.11's "ask at the value moment" philosophy, never on
 * screen mount.
 */
export async function ensureNotificationPermission(): Promise<NotificationPermissionStatus> {
  const current = await Notifications.getPermissionsAsync();
  if (current.status !== Notifications.PermissionStatus.UNDETERMINED) {
    return toStatus(current.status);
  }
  try {
    const requested = await Notifications.requestPermissionsAsync();
    return toStatus(requested.status);
  } catch {
    // Hardware/platform failure — treated as "still undetermined" rather
    // than thrown, matching the offline/failure-state requirement (every
    // native call in this app degrades gracefully, never crashes a screen).
    return "undetermined";
  }
}
