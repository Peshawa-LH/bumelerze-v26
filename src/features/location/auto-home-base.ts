import * as Location from "expo-location";
import { useEffect } from "react";
import { AppState } from "react-native";

import { haversineDistanceKm } from "@/features/events/distance";
import { HOME_BASE_TOWNS, usePrefsStore, type HomeBaseTown } from "@/features/onboarding";

/**
 * Automatic HomeBase: while location permission is granted and the user has
 * not picked a town themselves, HomeBase follows the nearest HomeBase town to
 * the device. It never prompts for permission (onboarding and Settings own
 * that), reads only the cached last-known fix when there is one, and runs at
 * most once a day, so it costs no battery to speak of.
 */

/** One automatic check per day. */
export const AUTO_HOME_BASE_REFRESH_MS = 24 * 60 * 60 * 1000;

/**
 * A device farther than this from every HomeBase town (a reader in Europe or
 * North America) is not "at home" anywhere on the list, so nothing is set:
 * assigning Erbil to someone in Berlin would be wrong, not helpful.
 */
export const AUTO_HOME_BASE_MAX_KM = 150;

export interface NearestHomeBaseTown {
  town: HomeBaseTown;
  distanceKm: number;
}

/** The closest HomeBase town to a point, or null beyond `AUTO_HOME_BASE_MAX_KM`. */
export function nearestHomeBaseTown(lat: number, lon: number): NearestHomeBaseTown | null {
  let best: NearestHomeBaseTown | null = null;
  for (const town of HOME_BASE_TOWNS) {
    const distanceKm = haversineDistanceKm(town.lat, town.lon, lat, lon);
    if (best === null || distanceKm < best.distanceKm) {
      best = { town, distanceKm };
    }
  }
  return best !== null && best.distanceKm <= AUTO_HOME_BASE_MAX_KM ? best : null;
}

export type AutoHomeBaseResult = "updated" | "unchanged" | "skipped";

async function readDeviceFix(): Promise<{ lat: number; lon: number } | null> {
  const permission = await Location.getForegroundPermissionsAsync();
  if (permission.status !== Location.PermissionStatus.GRANTED) {
    return null;
  }
  const cached = await Location.getLastKnownPositionAsync();
  const position =
    cached ??
    (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
  if (!position) {
    return null;
  }
  return { lat: position.coords.latitude, lon: position.coords.longitude };
}

/**
 * One automatic HomeBase check.
 * - "skipped": nothing was done (manual choice, checked within a day, no
 *   permission, no fix, or the prefs have not loaded yet). A check that could
 *   not run is not recorded, so the next launch tries again.
 * - "unchanged": the device is outside every town's range, or already at the
 *   stored town; the check is recorded.
 * - "updated": HomeBase now points at a new nearest town.
 */
export async function refreshAutoHomeBase(
  now: number = Date.now(),
): Promise<AutoHomeBaseResult> {
  const before = usePrefsStore.getState();
  if (!before.hasHydrated || before.homeBaseSource !== "auto") {
    return "skipped";
  }
  if (
    before.homeBaseAutoCheckedAt !== null &&
    now - before.homeBaseAutoCheckedAt < AUTO_HOME_BASE_REFRESH_MS
  ) {
    return "skipped";
  }

  let fix: { lat: number; lon: number } | null;
  try {
    fix = await readDeviceFix();
  } catch {
    // Any platform/hardware failure just means "no automatic update today";
    // the user's HomeBase is left exactly as it was.
    return "skipped";
  }
  if (!fix) {
    return "skipped";
  }

  const store = usePrefsStore.getState();
  // The user may have chosen a town by hand while the fix was being read.
  if (store.homeBaseSource !== "auto") {
    return "skipped";
  }

  const nearest = nearestHomeBaseTown(fix.lat, fix.lon);
  if (!nearest) {
    store.markHomeBaseAutoChecked(now);
    return "unchanged";
  }
  if (store.homeBase?.townId === nearest.town.id) {
    store.markHomeBaseAutoChecked(now);
    return "unchanged";
  }
  store.setAutoHomeBase(
    { townId: nearest.town.id, lat: nearest.town.lat, lon: nearest.town.lon },
    now,
  );
  return "updated";
}

/**
 * Mount once at the app root. Checks after the prefs load, whenever the app
 * returns to the foreground, and when the user picks "Use my location again"
 * (which clears the last-check time). `refreshAutoHomeBase` throttles itself.
 */
export function useAutoHomeBase(): void {
  const hasHydrated = usePrefsStore((state) => state.hasHydrated);
  const source = usePrefsStore((state) => state.homeBaseSource);
  const checkedAt = usePrefsStore((state) => state.homeBaseAutoCheckedAt);

  useEffect(() => {
    if (!hasHydrated || source !== "auto") {
      return;
    }
    void refreshAutoHomeBase();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void refreshAutoHomeBase();
      }
    });
    return () => subscription.remove();
  }, [hasHydrated, source, checkedAt]);
}
