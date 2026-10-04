import * as Location from "expo-location";
import { useEffect, useState } from "react";

/**
 * Read-only: is foreground location permission already granted? `null` until
 * the first answer. Never prompts (same contract as `useUserDistanceAnchor`),
 * so a screen can offer a location-based option only when it can work.
 */
export function useLocationPermissionGranted(): boolean | null {
  const [granted, setGranted] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    Location.getForegroundPermissionsAsync()
      .then((permission) => {
        if (!cancelled) {
          setGranted(permission?.status === Location.PermissionStatus.GRANTED);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setGranted(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return granted;
}
