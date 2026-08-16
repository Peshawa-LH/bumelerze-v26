import { Accelerometer } from "expo-sensors";
import { useCallback } from "react";

import {
  usePermissionRow,
  type PermissionRowStatus,
  type UsePermissionRowResult,
} from "./use-permission-row";

/** `expo-sensors` already returns plain `"granted"|"denied"|"undetermined"`
 * strings (see `features/sensor/use-accelerometer-stream.ts`'s own direct
 * string comparisons against the same API) — no enum-to-union mapping step
 * needed here, unlike `expo-location`'s `PermissionStatus` enum. */
function toStatus(status: string): PermissionRowStatus {
  return status === "granted" || status === "denied" ? status : "undetermined";
}

/**
 * Settings "Permissions & data" motion/sensor row (D26 item 6) — NATIVE
 * only. `app/(tabs)/settings.tsx` renders a different, link-only row on web
 * instead of using this hook's status/request pair at all: iOS Safari gates
 * `DeviceMotionEvent` behind a permission that can only be requested from
 * inside the live gesture on the Sensor screen itself
 * (`features/sensor/use-accelerometer-stream.ts`'s own
 * `hasWebMotionPermissionApi`/`requestWebPermission` — that complexity
 * belongs to that screen, not duplicated here); this hook's own
 * `getPermissionsAsync`/`requestPermissionsAsync` calls are still safe to
 * make on web (they simply resolve consistently, per `expo-sensors`), but
 * nothing in this Settings row reads their result on that platform.
 */
export function useMotionPermissionRow(): UsePermissionRowResult {
  const getStatus = useCallback(async () => {
    const result = await Accelerometer.getPermissionsAsync();
    return toStatus(result.status);
  }, []);

  const requestPermission = useCallback(async () => {
    const result = await Accelerometer.requestPermissionsAsync();
    return toStatus(result.status);
  }, []);

  return usePermissionRow(getStatus, requestPermission);
}
