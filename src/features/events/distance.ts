const EARTH_RADIUS_KM = 6371;

/** Exported for reuse by `features/geo/bearing.ts` — bearing math needs the
 * same degrees→radians conversion, and this stays the one module that owns
 * geodesic distance/bearing primitives (typescript-react-native.md "one
 * module owns scientific formatting" applied to the underlying math too,
 * not just the display strings). */
export function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Great-circle distance between two points, km. Standalone/pure so it's
 * trivially unit-testable and reusable by both the event-distance display
 * and `features/geo`'s nearest-city lookup. */
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

/**
 * Distance from an event to a real device fix (wave 5 simplification: the
 * feed card always shows the nearest-gazetteer-city distance now —
 * `features/geo`'s `nearestCities` — so the old no-permission
 * "nearest-of-three-anchors" fallback this module used to own
 * (`nearestAnchor`/`resolveEventDistance`/`REGION_ANCHORS`) is dead code,
 * removed in wave 5. This is the one remaining distance mode: the event
 * detail screen's "from you" line, shown only once a real fix exists.
 */
export function distanceFromUserKm(
  event: { lat: number; lon: number },
  userFix: { lat: number; lon: number },
): number {
  return haversineDistanceKm(event.lat, event.lon, userFix.lat, userFix.lon);
}
