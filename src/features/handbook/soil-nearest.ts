import { haversineDistanceKm } from "@/features/events/distance";
import { SOIL_NEARBY_RADIUS_KM } from "./config";
import type { NearbySoilPoint, SoilPoint } from "./types";

/**
 * Sulaimani soil/site points within `SOIL_NEARBY_RADIUS_KM` of `(lat, lon)`,
 * nearest first — empty (not null) when nothing qualifies, so the caller's
 * "else section hidden" rule (spec-v1.md §7) is a plain length check.
 * Reuses `haversineDistanceKm` rather than reimplementing distance math
 * (typescript-react-native.md "one module owns scientific formatting").
 */
export function nearbySoilPoints(
  lat: number,
  lon: number,
  points: readonly SoilPoint[],
): NearbySoilPoint[] {
  return points
    .map((point) => ({ point, distanceKm: haversineDistanceKm(lat, lon, point.lat, point.lon) }))
    .filter((entry) => entry.distanceKm <= SOIL_NEARBY_RADIUS_KM)
    .sort((a, b) => a.distanceKm - b.distanceKm);
}
