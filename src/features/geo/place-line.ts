import type { TFunction } from "i18next";

// See bearing.ts's comment: imported from the concrete module to avoid a
// require-cycle through the `@/features/events` barrel (which re-exports
// `EventCard`, itself importing from `@/features/geo`).
import { formatIsolatedDistance } from "@/features/events/format";
import { DIRECTION_I18N_KEYS } from "./bearing";
import { NEAREST_CITY_FALLBACK_THRESHOLD_KM } from "./config";
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
  /** Provider place string (USGS `properties.place`) — the fallback when
   * nothing in the gazetteer is close enough (see
   * `NEAREST_CITY_FALLBACK_THRESHOLD_KM`). Deliberately never translated:
   * far-world events are outside this app's core Kurdish-language mission,
   * and translating arbitrary place names for the rest of the world isn't
   * in scope — English stays acceptable there (ui-backlog.md wave 5 item
   * 4). */
  placeName: string;
  /** Optional i18n key resolving to a translated place string, used
   * INSTEAD of the raw `placeName` above when this event falls beyond the
   * gazetteer's fallback radius. Live provider feeds never set this (their
   * place strings are out-of-scope provider data, per `placeName`'s own
   * comment) — this exists for small, APP-OWNED curated datasets (e.g. the
   * Historical View's 11 events, `features/historical/notable-events.ts`)
   * that need a real Kurdish/Arabic name for a far-world place instead of
   * always falling back to English (update-plan-2026-08.md §1.4). */
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
 * Localized place line for an event (ui-backlog.md wave 5 item 3):
 * "{distance} {direction} of {city}, {region}" built entirely from the
 * bundled gazetteer, replacing USGS's English `place` string for any event
 * within `NEAREST_CITY_FALLBACK_THRESHOLD_KM` of a bundled city. Farther
 * events fall back to the raw provider string (see `PlaceLineEvent.placeName`
 * doc comment) — a world-catalog earthquake that's nowhere near Kurdistan
 * gets no localized treatment, by design.
 */
export function placeLine(event: PlaceLineEvent, locale: string, t: TranslateFn): string {
  const [nearest] = nearestCities(event.lat, event.lon, 1);

  if (!nearest || nearest.distanceKm > NEAREST_CITY_FALLBACK_THRESHOLD_KM) {
    return event.placeNameKey ? t(event.placeNameKey) : event.placeName;
  }

  const line = nearestCityLine(nearest, locale, t);
  const regionKey = resolveRegionLabelKey(nearest.city, event.lat, event.lon);
  const region = t(`geo.regions.${regionKey}`);
  return t("geo.placeLine.withRegion", { line, region });
}
