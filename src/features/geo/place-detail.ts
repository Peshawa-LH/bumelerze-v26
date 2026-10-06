import { GAZETTEER_CITIES } from "./gazetteer";
import { nearestCities } from "./nearest";
import { type Place, placeDisplayName } from "./place-search";
import { resolveRegionLabelKey } from "./region";
import type { TranslateFn } from "./place-line";

const FIRST_STRONG_ISOLATE = "⁨";
const POP_DIRECTIONAL_ISOLATE = "⁩";

/** Wraps a name so its script cannot reorder the words around it (a Latin
 * village name inside a Sorani sentence, or the reverse). */
export function isolateName(name: string): string {
  return `${FIRST_STRONG_ISOLATE}${name}${POP_DIRECTIONAL_ISOLATE}`;
}

/**
 * The quiet second line under a place name: a city shows where it is (its
 * region, as on the event place lines); a town or village shows "near" the
 * closest gazetteer city.
 */
export function placeDetailLine(place: Place, locale: string, t: TranslateFn): string {
  if (place.kind === "city") {
    const city = GAZETTEER_CITIES.find((candidate) => candidate.id === place.id);
    if (city) {
      return t(`geo.regions.${resolveRegionLabelKey(city)}`);
    }
  }
  const [nearest] = nearestCities(place.lat, place.lon, 1);
  if (!nearest) {
    return "";
  }
  const cityName = placeDisplayName(
    {
      id: nearest.city.id,
      kind: "city",
      lat: nearest.city.lat,
      lon: nearest.city.lon,
      names: nearest.city.names,
    },
    locale,
  );
  return t("placeSearch.nearCity", { city: isolateName(cityName) });
}
