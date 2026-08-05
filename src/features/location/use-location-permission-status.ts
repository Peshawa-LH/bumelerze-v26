import { useFocusEffect } from "expo-router";
import * as Location from "expo-location";
import { useCallback, useState } from "react";

export type LocationPermissionStatus = "granted" | "denied" | "undetermined";

function toStatus(result: Location.PermissionStatus): LocationPermissionStatus {
  if (result === Location.PermissionStatus.GRANTED) {
    return "granted";
  }
  if (result === Location.PermissionStatus.DENIED) {
    return "denied";
  }
  return "undetermined";
}

/**
 * Current foreground-location permission status, re-checked every time the
 * screen regains focus (e.g. returning from the system Settings app after
 * toggling it there) — no polling, matches the battery-conscious pattern
 * already used by the sensor screen's focus-gated subscription. Used by the
 * Settings "location permission" status row (wave brief point 4).
 */
export function useLocationPermissionStatus(): LocationPermissionStatus {
  const [status, setStatus] = useState<LocationPermissionStatus>("undetermined");

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;

      Location.getForegroundPermissionsAsync()
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
