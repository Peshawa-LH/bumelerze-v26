// See bearing.ts's comment: imported from the concrete module to avoid a
// require-cycle through the `@/features/events` barrel (which re-exports
// `EventCard`, itself importing from `@/features/geo`).
import { haversineDistanceKm } from "@/features/events/distance";
import { bearing8, type DirectionKey } from "./bearing";
import { DEFAULT_NEAREST_CITY_COUNT } from "./config";
import { GAZETTEER_CITIES, type GazetteerCity } from "./gazetteer";

export interface NearestCityResult {
  city: GazetteerCity;
  distanceKm: number;
  /** Compass direction from the city TOWARD the point queried (matches the
   * USGS-style "{distance} {direction} of {city}" phrasing — direction is
   * "which way from the city do you look to find the point", not the
   * reverse). */
  direction: DirectionKey;
}

/**
 * The `n` closest gazetteer cities to a point, nearest first. Reuses
 * `haversineDistanceKm` from `events/distance.ts` rather than
 * reimplementing distance math (typescript-react-native.md "one module
 * owns scientific formatting", extended to the shared geodesic
 * primitives). `GAZETTEER_CITIES` is a non-empty compile-time constant and
 * `n` is expected positive, so this always returns at least one result for
 * any `n >= 1`.
 */
export function nearestCities(
  lat: number,
  lon: number,
  n: number = DEFAULT_NEAREST_CITY_COUNT,
): NearestCityResult[] {
  return GAZETTEER_CITIES.map((city) => ({
    city,
    distanceKm: haversineDistanceKm(city.lat, city.lon, lat, lon),
    direction: bearing8({ lat: city.lat, lon: city.lon }, { lat, lon }),
  }))
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, n);
}
