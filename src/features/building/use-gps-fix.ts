import * as Location from "expo-location";
import { useCallback, useState } from "react";

export type GpsStatus = "idle" | "busy" | "failed";

/**
 * One-shot location fix for the tag flow. Asks for foreground permission only
 * when the user taps "Use my location" (never on screen open), takes a single
 * balanced-accuracy fix and stops: no tracking, no background use.
 */
export function useGpsFix(): {
  status: GpsStatus;
  request: () => Promise<{ lat: number; lon: number } | null>;
} {
  const [status, setStatus] = useState<GpsStatus>("idle");

  const request = useCallback(async () => {
    setStatus("busy");
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== Location.PermissionStatus.GRANTED) {
        setStatus("failed");
        return null;
      }
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      setStatus("idle");
      return { lat: position.coords.latitude, lon: position.coords.longitude };
    } catch {
      setStatus("failed");
      return null;
    }
  }, []);

  return { status, request };
}
