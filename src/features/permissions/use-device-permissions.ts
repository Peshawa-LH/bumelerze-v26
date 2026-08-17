import { useCallback, useState } from "react";

import { useLocationPermissionRow } from "./use-location-permission-row";
import { useMotionPermissionRow } from "./use-motion-permission-row";
import type { PermissionRowStatus } from "./use-permission-row";

export interface UseDevicePermissionsResult {
  locationStatus: PermissionRowStatus;
  motionStatus: PermissionRowStatus;
  /** True while a combined request is in flight, so the caller can disable
   * the button and avoid a double-tap re-firing the OS/browser prompts. */
  isRequesting: boolean;
  /** Chains every non-notification permission (location, then motion) from
   * a single tap. Must be called directly from a `Pressable`'s `onPress` —
   * see the doc comment below for why. */
  requestAll: () => void;
}

/**
 * Settings' single "Device permissions" control (owner request, wave brief
 * Part 3: "ONE button ... location, sensor, and other permissions", no
 * separate per-permission ask). Composes the two existing, already-tested
 * per-permission hooks rather than re-implementing status/focus-recheck
 * plumbing (`use-location-permission-row.ts`, `use-motion-permission-row.ts`
 * both wrap `use-permission-row.ts`, which never throws out of a tap
 * handler and re-checks status on focus).
 *
 * The one thing this hook adds is the *chaining*: both underlying `request()`
 * calls are invoked synchronously, back to back, in the same call stack as
 * the tap, with no `await` between them. On native the order doesn't matter,
 * but on web it's load-bearing — iOS Safari only honors
 * `DeviceMotionEvent.requestPermission()` (which `expo-sensors`'
 * `Accelerometer.requestPermissionsAsync()` calls under the hood on web)
 * when it's invoked from inside the original user-gesture call stack, the
 * same constraint `features/sensor/use-accelerometer-stream.ts`'s
 * `requestWebPermission` documents. Calling `location.request()` and then
 * `motion.request()` back to back (not `await`-ing the first before calling
 * the second) keeps both underlying calls inside that same synchronous
 * gesture, even though the function that kicks them off is itself async.
 */
export function useDevicePermissions(): UseDevicePermissionsResult {
  const location = useLocationPermissionRow();
  const motion = useMotionPermissionRow();
  const [isRequesting, setIsRequesting] = useState(false);

  const locationRequest = location.request;
  const motionRequest = motion.request;

  const requestAll = useCallback(() => {
    setIsRequesting(true);
    // Do not `await` one before calling the other — see doc comment above.
    const locationPromise = locationRequest();
    const motionPromise = motionRequest();
    void Promise.allSettled([locationPromise, motionPromise]).finally(() => {
      setIsRequesting(false);
    });
  }, [locationRequest, motionRequest]);

  return {
    locationStatus: location.status,
    motionStatus: motion.status,
    isRequesting,
    requestAll,
  };
}
