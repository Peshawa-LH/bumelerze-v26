import { haversineDistanceKm } from "@/features/events/distance";
import { GAZETTEER_CITIES, MAIN_TOWNS, type GazetteerCity } from "@/features/geo";
import { SHAKEMAP_MAX_CITIES } from "./config";
import type { LonLatBoundingBox } from "./projection";

/** The curated ~18 main towns as a cheap "this is a place people actually
 * orient by" priority signal (we don't carry real population figures, and
 * this list is already hand-curated for exactly that "known bigger town"
 * judgment call). */
const PRIORITY_TOWN_IDS = new Set<string>(MAIN_TOWNS.map((town) => town.id));

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
 * restricted to the map's own bounding box, main-town ("known
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
