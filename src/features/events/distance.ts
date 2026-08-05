import { REGION_ANCHORS, type RegionAnchor } from "./config";
import type { Event } from "./types";

const EARTH_RADIUS_KM = 6371;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Great-circle distance between two points, km. Standalone/pure so it's
 * trivially unit-testable and reusable once real device-location distance
 * (a later wave, not this one — no expo-location yet) needs the same math. */
export function haversineDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

export interface AnchorDistance {
  anchor: RegionAnchor;
  distanceKm: number;
}

/**
 * Distance from an event to the nearest of the three region-anchor cities
 * (Erbil/Slemani/Duhok) — the only distance mode this wave supports, since
 * no location permission is requested yet (spec-v1.md §4.1 "no location
 * permission" state: "never '?' or '–'"). `REGION_ANCHORS` is never empty,
 * so this always returns a result.
 */
export function nearestAnchor(lat: number, lon: number): AnchorDistance {
  let best: AnchorDistance | null = null;

  for (const anchor of REGION_ANCHORS) {
    const distanceKm = haversineDistanceKm(lat, lon, anchor.lat, anchor.lon);
    if (!best || distanceKm < best.distanceKm) {
      best = { anchor, distanceKm };
    }
  }

  // REGION_ANCHORS is a non-empty compile-time constant; `best` is always set.
  return best as AnchorDistance;
}

/**
 * "fromUser" once a real device fix is available (wave brief point 3:
 * "distances in feed/detail become 'from you'"); "fromAnchor" is the
 * existing no-permission fallback (spec-v1.md §4.1, never a bare "?").
 * Discriminated on `mode` so `anchorNameKey` is only reachable (and only
 * required) on the branch that actually has one.
 */
export type EventDistanceDisplay =
  | { distanceKm: number; mode: "fromUser" }
  | { distanceKm: number; mode: "fromAnchor"; anchorNameKey: string };

/**
 * Picks which distance phrasing an event card/detail screen should use:
 * "from you" when a real device fix is available (`useUserDistanceAnchor`),
 * otherwise the existing nearest-region-anchor fallback. Kept as a small
 * pure function (not baked into the hook) so callers stay easy to test and
 * this module remains the single owner of distance math/formatting,
 * per the typescript-react-native.md "one module owns scientific
 * formatting" rule.
 */
export function resolveEventDistance(
  event: Pick<Event, "lat" | "lon">,
  userFix: { lat: number; lon: number } | null,
): EventDistanceDisplay {
  if (userFix) {
    return {
      distanceKm: haversineDistanceKm(event.lat, event.lon, userFix.lat, userFix.lon),
      mode: "fromUser",
    };
  }

  const { anchor, distanceKm } = nearestAnchor(event.lat, event.lon);
  return { distanceKm, mode: "fromAnchor", anchorNameKey: anchor.nameKey };
}
