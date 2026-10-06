import type { TFunction } from "i18next";

// See bearing.ts's comment: imported from the concrete module to avoid a
// require-cycle through the `@/features/events` barrel (which re-exports
// `EventCard`, itself importing from `@/features/geo`).
import { formatIsolatedDistance } from "@/features/events/format";
import { DIRECTION_I18N_KEYS } from "./bearing";
import { NEAREST_CITY_FALLBACK_THRESHOLD_KM } from "./config";
import { flinnEngdahlRegionName } from "./fe-region-name";
import { pickLocalizedName } from "./gazetteer";
import { nearestCities, type NearestCityResult } from "./nearest";
import { resolveRegionLabelKey } from "./region";

/** react-i18next's own `t` type, aliased here so every call site (screens
 * passing their `useTranslation()` `t` in) can pass it straight through
 * without a structural-typing mismatch — i18next's `TFunction` overloads
 * are specific enough that a hand-rolled "generic function" shape doesn't
 * reliably satisfy `exactOptionalPropertyTypes`. */
export type TranslateFn = TFunction;

export interface PlaceLineEvent {
  lat: number;
  lon: number;
  /** Optional i18n key resolving to a translated place string, used
   * INSTEAD of the Flinn-Engdahl region name when this event falls beyond the
   * gazetteer's near-field radius. Live provider feeds never set this — this
   * exists for small, APP-OWNED curated datasets (e.g. the Historical View's
   * 11 events, `features/historical/notable-events.ts`) that need a real
   * Kurdish/Arabic name for a far-world place (update-plan-2026-08.md §1.4).
   * The provider's own place string is deliberately NOT an input: a place
   * line is always ours (owner directive 2026-09-02, D28). */
  placeNameKey?: string;
}

/** The bare "{{distance}} {{direction}} {{city}}" phrase, without the
 * region suffix — used both by `placeLine` (which appends a region) and
 * directly by the event-detail multi-city distance list, which shows
 * several of these without repeating the region label each time. */
export function nearestCityLine(
  result: NearestCityResult,
  locale: string,
  t: TranslateFn,
): string {
  const distance = formatIsolatedDistance(result.distanceKm, locale, t("units.km"));
  const direction = t(DIRECTION_I18N_KEYS[result.direction]);
  const city = pickLocalizedName(result.city.names, locale);
  return t("geo.placeLine.template", { distance, direction, city });
}

/** Simple "{{distance}} from {{city}}" phrase (no compass direction) — used
 * by the event-detail multi-city distance list (ui-backlog.md wave 5 item
 * 5), which shows several of these in a row and doesn't need the fuller
 * `nearestCityLine` phrasing repeated each time. */
export function nearestCityDistanceLine(
  result: NearestCityResult,
  locale: string,
  t: TranslateFn,
): string {
  const distance = formatIsolatedDistance(result.distanceKm, locale, t("units.km"));
  const city = pickLocalizedName(result.city.names, locale);
  return t("events.distanceFromCity", { distance, city });
}

/**
 * The single naming rule for an event, used by every surface (Home, World,
 * Significant, Catalog, map sheet, event detail title) so one epicentre has
 * one name everywhere (D28 decision 1 and 2, `feedback-waves.md` "F6
 * resolved"):
 *
 * - **Near field** (a gazetteer town within
 *   `NEAREST_CITY_FALLBACK_THRESHOLD_KM`): "{distance} {direction} of {city},
 *   {region}" built from the bundled gazetteer. It never regresses to a
 *   country: a Sulaimani event is "... Slemani, Kurdistan (Iraq)", not "Iraq".
 * - **Far field**: the translated Flinn-Engdahl region name of the epicentre
 *   (`flinnEngdahlRegionName`), with no bearing or distance (a "500 km NNE of
 *   somewhere nobody knows" line is noise at that range). The region is
 *   derived from the coordinates, so USGS, EMSC, GEOFON, the catalog and the
 *   Historical View all agree; a region without a translation shows its
 *   English F-E name, never the provider's prose. A curated `placeNameKey`
 *   (app-owned datasets) wins over the F-E name.
 * - Last resort, only for a coordinate that is not on the globe: the
 *   coordinate pair.
 */
export function placeLine(event: PlaceLineEvent, locale: string, t: TranslateFn): string {
  const [nearest] = nearestCities(event.lat, event.lon, 1);

  if (!nearest || nearest.distanceKm > NEAREST_CITY_FALLBACK_THRESHOLD_KM) {
    if (event.placeNameKey) {
      return t(event.placeNameKey);
    }
    const regionName = flinnEngdahlRegionName(event.lat, event.lon, locale);
    if (regionName) {
      return regionName;
    }
    return t("geo.placeLine.coordinates", {
      lat: event.lat.toFixed(2),
      lon: event.lon.toFixed(2),
    });
  }

  const line = nearestCityLine(nearest, locale, t);
  const region = t(`geo.regions.${resolveRegionLabelKey(nearest.city)}`);
  return t("geo.placeLine.withRegion", { line, region });
}
