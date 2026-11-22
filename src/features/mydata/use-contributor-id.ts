import { useEffect, useState } from "react";

import { getDeviceId, subscribeToDeviceIdReset } from "@/features/felt/device-id";
import { deviceFingerprint } from "@/lib/device-fingerprint";

/**
 * The contributor ID for Privacy & data (D26 item 7): the device's
 * FINGERPRINT (first 8 hex characters of the SHA-256 of the device id,
 * `src/lib/device-fingerprint.ts`), never the device id itself, which is a
 * credential (security audit DB-03). Lower case; `formatContributorId`
 * shows it.
 *
 * `getDeviceId()` and the hash are async, so this starts `null` and fills
 * in once resolved rather than blocking the screen's first render. After a
 * sign-out the device gets a new id (`resetDeviceId`) and the ID shown
 * follows. Where hashing is unavailable (a web page on plain http) it stays
 * `null`: the row keeps its "…" instead of a made-up value.
 */
export function useContributorId(): string | null {
  const [fingerprint, setFingerprint] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);

  useEffect(
    () => subscribeToDeviceIdReset(() => setGeneration((value) => value + 1)),
    [],
  );

  useEffect(() => {
    let cancelled = false;

    getDeviceId()
      .then(deviceFingerprint)
      .then((value) => {
        if (!cancelled) {
          setFingerprint(value);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFingerprint(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [generation]);

  return fingerprint;
}
