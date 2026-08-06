import { haversineDistanceKm } from "@/features/events/distance";
import { GAZETTEER_CITIES, type GazetteerCity } from "@/features/geo";
import { HOME_BASE_TOWNS } from "@/features/onboarding/towns";
import { SHAKEMAP_MAX_CITIES } from "./config";
import type { LonLatBoundingBox } from "./projection";

/** Reuses the onboarding HomeBase picker's curated ~18-town subset as a
 * cheap "this is a place people actually orient by" priority signal (wave
 * brief point 2: "use the onboarding-subset flag" — we don't carry real
 * population figures, and this list is already hand-curated for exactly
 * that "known bigger town" judgment call). Read-only reference into
 * `features/onboarding` (its own internal id list isn't exported, so this
 * derives ids from the exported `HOME_BASE_TOWNS` objects instead — not a
 * modification of that module). */
const PRIORITY_TOWN_IDS = new Set<string>(HOME_BASE_TOWNS.map((town) => town.id));

function isInBbox(city: GazetteerCity, bbox: LonLatBoundingBox): boolean {
  return (
    city.lon >= bbox.minLon &&
    city.lon <= bbox.maxLon &&
    city.lat >= bbox.minLat &&
    city.lat <= bbox.maxLat
  );
}

/**
 * Up to `SHAKEMAP_MAX_CITIES` gazetteer cities to label on the map:
 * restricted to the map's own bounding box, HomeBase-subset ("known
 * bigger town") cities ranked first, remaining slots filled nearest-to-
 * center first (wave brief point 2's fallback ordering).
 */
export function pickMapCities(
  bbox: LonLatBoundingBox,
  center: { lat: number; lon: number },
  max: number = SHAKEMAP_MAX_CITIES,
): GazetteerCity[] {
  const inBbox = GAZETTEER_CITIES.filter((city) => isInBbox(city, bbox));

  const sorted = [...inBbox].sort((a, b) => {
    const aPriority = PRIORITY_TOWN_IDS.has(a.id) ? 0 : 1;
    const bPriority = PRIORITY_TOWN_IDS.has(b.id) ? 0 : 1;
    if (aPriority !== bPriority) {
      return aPriority - bPriority;
    }
    const distanceA = haversineDistanceKm(a.lat, a.lon, center.lat, center.lon);
    const distanceB = haversineDistanceKm(b.lat, b.lon, center.lat, center.lon);
    return distanceA - distanceB;
  });

  return sorted.slice(0, max);
}
