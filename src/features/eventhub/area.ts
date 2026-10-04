import { decodeGeohashBounds } from "@/features/feltmap/geohash-bounds";
import { nearestCities, pickLocalizedName } from "@/features/geo";

/** A commenter's area is a ~5 km cell; a gazetteer city farther than this
 * from its centre would make "near {city}" misleading, so no line is shown. */
export const AREA_CITY_MAX_KM = 100;

/** Centre of a geohash cell. Used only to pick a city; never displayed. */
export function geohashCenter(geohash: string): { lat: number; lon: number } {
  const bounds = decodeGeohashBounds(geohash);
  return {
    lat: (bounds.minLat + bounds.maxLat) / 2,
    lon: (bounds.minLon + bounds.maxLon) / 2,
  };
}

/**
 * The gazetteer city nearest to a commenter's area cell, in the reader's
 * language, or null when there is no area or no city is close enough. The
 * cell's coordinates themselves are never exposed.
 */
export function areaCityName(
  geohash: string | null | undefined,
  locale: string,
): string | null {
  if (!geohash || !/^[0-9b-hjkmnp-z]{1,12}$/i.test(geohash)) {
    return null;
  }
  const { lat, lon } = geohashCenter(geohash);
  const [nearest] = nearestCities(lat, lon, 1);
  if (!nearest || nearest.distanceKm > AREA_CITY_MAX_KM) {
    return null;
  }
  return pickLocalizedName(nearest.city.names, locale);
}
