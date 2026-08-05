import * as Location from "expo-location";
import { useEffect, useState } from "react";

/**
 * Discriminated on `hasFix` so a caller narrowing on it gets real `number`
 * coordinates with no optional-chaining/casts — never a bare "?" fallback
 * is needed at the type level either (spec-v1.md §4.1, B10).
 */
export type UserDistanceAnchor =
  { hasFix: true; lat: number; lon: number } | { hasFix: false; lat: null; lon: null };

const NO_FIX: UserDistanceAnchor = { hasFix: false, lat: null, lon: null };

/**
 * Read-only foreground-location check used by the feed/detail distance
 * display (wave brief point 3). Deliberately never *requests* permission —
 * the onboarding location screen owns that one-time ask (spec-v1.md §4.11
 * step 3) — so this hook is safe to call from every screen that shows a
 * distance without ever surprising the user with a permission prompt
 * outside onboarding.
 */
export function useUserDistanceAnchor(): UserDistanceAnchor {
  const [anchor, setAnchor] = useState<UserDistanceAnchor>(NO_FIX);

  useEffect(() => {
    let cancelled = false;

    async function resolve() {
      try {
        const permission = await Location.getForegroundPermissionsAsync();
        if (cancelled || permission.status !== Location.PermissionStatus.GRANTED) {
          return;
        }

        // Last-known fix first — near-instant and battery-friendly
        // (PROJECT.md: no aggressive background polling / wake-lock abuse).
        // Only requests a fresh fix if nothing is cached yet.
        const cached = await Location.getLastKnownPositionAsync();
        const position =
          cached ??
          (await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          }));
        if (cancelled || !position) {
          return;
        }

        setAnchor({
          hasFix: true,
          lat: position.coords.latitude,
          lon: position.coords.longitude,
        });
      } catch {
        // Any platform/hardware failure just leaves the anchor fallback in
        // place — never a blocking error state (spec-v1.md §4.1).
      }
    }

    void resolve();

    return () => {
      cancelled = true;
    };
  }, []);

  return anchor;
}
