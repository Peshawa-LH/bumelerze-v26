import { useEffect, useState } from "react";

import { getDeviceId } from "@/features/felt";

/**
 * The full per-install device id for the My Data header (D26 item 7).
 * `getDeviceId()` is async (first call generates + persists a fresh
 * AsyncStorage-backed uuid; every call after that resolves instantly from
 * the in-memory cache — see `features/felt/device-id.ts`), so this hook
 * starts `null` and fills in once resolved rather than blocking the
 * screen's first render on it.
 */
export function useContributorId(): string | null {
  const [deviceId, setDeviceId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    getDeviceId()
      .then((value) => {
        if (!cancelled) {
          setDeviceId(value);
        }
      })
      .catch(() => {
        // getDeviceId() never rejects in practice (AsyncStorage failures
        // aren't expected on a real device), but per the "no silent
        // catches" rule this still surfaces as a visible, if unremarkable,
        // outcome: the header simply keeps showing its loading state
        // instead of a fabricated id.
        if (!cancelled) {
          setDeviceId(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return deviceId;
}
