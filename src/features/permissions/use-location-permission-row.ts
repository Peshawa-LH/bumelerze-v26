import * as Location from "expo-location";
import { useCallback } from "react";

import {
  usePermissionRow,
  type PermissionRowStatus,
  type UsePermissionRowResult,
} from "./use-permission-row";

function toStatus(result: Location.PermissionStatus): PermissionRowStatus {
  if (result === Location.PermissionStatus.GRANTED) {
    return "granted";
  }
  if (result === Location.PermissionStatus.DENIED) {
    return "denied";
  }
  return "undetermined";
}

/**
 * Settings "Permissions & data" location row (D26 item 6). Distinct from
 * `features/location/use-location-permission-status.ts` (the existing
 * read-only HomeBase-adjacent status display, left untouched per this
 * wave's "move nothing existing" scope) — this hook additionally exposes a
 * tap-triggered `request()`, which that read-only hook deliberately does
 * not.
 */
export function useLocationPermissionRow(): UsePermissionRowResult {
  const getStatus = useCallback(async () => {
    const result = await Location.getForegroundPermissionsAsync();
    return toStatus(result.status);
  }, []);

  const requestPermission = useCallback(async () => {
    const result = await Location.requestForegroundPermissionsAsync();
    return toStatus(result.status);
  }, []);

  return usePermissionRow(getStatus, requestPermission);
}
