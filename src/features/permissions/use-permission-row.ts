import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";

/**
 * Settings "Permissions & data" section (D26 item 6: "a proper permissions
 * section in Settings ... explains and manages what is collected"). Shared
 * plumbing for one permission row: current status, re-checked on every
 * screen focus (matches `features/location/use-location-permission-status.ts`'s
 * own re-check-on-focus rationale — the user may come straight back from the
 * system Settings app after toggling it there), plus a `request()` action
 * that MUST be invoked from a `Pressable`'s `onPress` (never automatically)
 * so an OS permission prompt is always the direct result of a user tap, per
 * spec-v1.md §4.11's "ask only at the value moment" policy this app already
 * follows for notifications (`notification-settings.tsx`).
 */
export type PermissionRowStatus = "granted" | "denied" | "undetermined";

export interface UsePermissionRowResult {
  status: PermissionRowStatus;
  /** Calls the underlying native `request*PermissionsAsync()` and updates
   * `status` from its result. Safe to call when already granted/denied —
   * the OS itself decides whether a prompt actually appears (a "denied"
   * status on most platforms means the OS won't re-prompt at all, which is
   * exactly why the row also offers "open system settings" in that state —
   * see the two concrete hooks below, not this shared file). */
  request: () => Promise<void>;
}

/**
 * Generic status/request wiring, parameterized over the two native APIs
 * this Settings section needs (`expo-location`, `expo-sensors`) so neither
 * concrete hook below has to re-implement the focus-recheck/error-fallback
 * plumbing. `getStatus`/`requestPermission` must be stable identities
 * (wrapped in `useCallback` by the caller) — see the exhaustive-deps note
 * on the focus effect below.
 */
export function usePermissionRow(
  getStatus: () => Promise<PermissionRowStatus>,
  requestPermission: () => Promise<PermissionRowStatus>,
): UsePermissionRowResult {
  const [status, setStatus] = useState<PermissionRowStatus>("undetermined");

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;

      getStatus()
        .then((result) => {
          if (!cancelled) {
            setStatus(result);
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
      // eslint-disable-next-line react-hooks/exhaustive-deps -- getStatus is a stable per-hook-instance callback from the caller
    }, []),
  );

  const request = useCallback(async () => {
    try {
      const result = await requestPermission();
      setStatus(result);
    } catch {
      // Never throw out of a tap handler (typescript-react-native rule: "no
      // silent catches") — falling back to "undetermined" keeps the row
      // showing an actionable state (the request button stays visible)
      // rather than freezing on whatever it showed before the failed tap.
      setStatus("undetermined");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- requestPermission is a stable per-hook-instance callback from the caller
  }, []);

  return { status, request };
}
