export {
  bearing8,
  bearingDegrees,
  DIRECTION_I18N_KEYS,
  type DirectionKey,
  type LatLon,
} from "./bearing";
export {
  DEFAULT_NEAREST_CITY_COUNT,
  KURDISTAN_REGION_BBOX,
  NEAREST_CITY_FALLBACK_THRESHOLD_KM,
} from "./config";
export {
  GAZETTEER_CITIES,
  pickLocalizedName,
  type GazetteerCity,
  type GazetteerCityNames,
  type GazetteerCountry,
} from "./gazetteer";
export {
  kurdishPlacesSchema,
  parseKurdishPlaces,
  resolveKurdishPlaceName,
  type KurdishPlace,
  type KurdishPlaceNames,
  type KurdishPlaceTier,
} from "./kurdish-places";
export { nearestCities, type NearestCityResult } from "./nearest";
export {
  nearestCityDistanceLine,
  nearestCityLine,
  placeLine,
  type PlaceLineEvent,
  type TranslateFn,
} from "./place-line";
export {
  isPointInKurdistanRegion,
  resolveFarFieldRegionKey,
  resolveRegionLabelKey,
  type FarFieldRegionKey,
  type RegionLabelKey,
} from "./region";
