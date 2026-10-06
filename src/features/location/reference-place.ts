import * as Location from "expo-location";
import { useEffect } from "react";
import { AppState } from "react-native";

import { haversineDistanceKm } from "@/features/events/distance";
import { MAIN_TOWNS, type MainTown } from "@/features/geo/main-towns";
import { applyDefaultReferencePlace, usePrefsStore } from "@/features/onboarding";

/**
 * The background reference place. It is never shown to the reader: it is the
 * nearest main town to the last location fix (Hawler when there is none), and
 * only serves as the default where a place must be pre-selected (the felt
 * report without GPS, the starting point of the Tag my building pin).
 *
 * It never prompts for permission (onboarding and Settings own that), reads
 * only the cached last-known fix when there is one, and runs at most once a
 * day, so it costs no battery to speak of.
 */

/** One check per day. */
export const REFERENCE_PLACE_REFRESH_MS = 24 * 60 * 60 * 1000;

/**
 * A device farther than this from every main town (a reader in Europe or
 * North America) has no reference place of its own, so nothing is changed:
 * assigning Hawler to someone in Berlin would be wrong, not helpful.
 */
export const REFERENCE_PLACE_MAX_KM = 150;

export interface NearestMainTown {
  town: MainTown;
  distanceKm: number;
}

/** The closest main town to a point, or null beyond `REFERENCE_PLACE_MAX_KM`. */
export function nearestMainTown(lat: number, lon: number): NearestMainTown | null {
  let best: NearestMainTown | null = null;
  for (const town of MAIN_TOWNS) {
    const distanceKm = haversineDistanceKm(town.lat, town.lon, lat, lon);
    if (best === null || distanceKm < best.distanceKm) {
      best = { town, distanceKm };
    }
  }
  return best !== null && best.distanceKm <= REFERENCE_PLACE_MAX_KM ? best : null;
}

export type ReferencePlaceResult = "updated" | "unchanged" | "skipped";

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
 * One reference-place check.
 * - "skipped": nothing was done (checked within a day, no permission, no fix,
 *   or the prefs have not loaded yet). A check that could not run is not
 *   recorded, so the next launch tries again.
 * - "unchanged": the device is outside every town's range, or already at the
 *   stored town; the check is recorded.
 * - "updated": the reference now points at a new nearest town.
 */
export async function refreshReferencePlace(
  now: number = Date.now(),
): Promise<ReferencePlaceResult> {
  const before = usePrefsStore.getState();
  if (!before.hasHydrated) {
    return "skipped";
  }
  if (
    before.referenceCheckedAt !== null &&
    now - before.referenceCheckedAt < REFERENCE_PLACE_REFRESH_MS
  ) {
    return "skipped";
  }

  let fix: { lat: number; lon: number } | null;
  try {
    fix = await readDeviceFix();
  } catch {
    // Any platform/hardware failure just means "no update today"; the
    // reference place is left exactly as it was.
    return "skipped";
  }
  if (!fix) {
    return "skipped";
  }

  const store = usePrefsStore.getState();
  const nearest = nearestMainTown(fix.lat, fix.lon);
  if (!nearest || store.referencePlace?.placeId === nearest.town.id) {
    store.markReferenceChecked(now);
    return "unchanged";
  }
  store.setReferencePlace(
    { placeId: nearest.town.id, lat: nearest.town.lat, lon: nearest.town.lon },
    now,
  );
  return "updated";
}

/**
 * Mount once at the app root. Fills the Hawler fallback when there is no
 * reference yet, then checks after the prefs load and whenever the app returns
 * to the foreground. `refreshReferencePlace` throttles itself.
 */
export function useReferencePlace(): void {
  const hasHydrated = usePrefsStore((state) => state.hasHydrated);

  useEffect(() => {
    if (!hasHydrated) {
      return;
    }
    applyDefaultReferencePlace();
    void refreshReferencePlace();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void refreshReferencePlace();
      }
    });
    return () => subscription.remove();
  }, [hasHydrated]);
}
