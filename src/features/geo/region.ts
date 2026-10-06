import { KURDISTAN_REGION_BBOX } from "./config";
import type { GazetteerCity, GazetteerCountry } from "./gazetteer";

/** True when a point falls inside the (simplified, bbox) Kurdistan Region
 * boundary — see config.ts's doc comment for why this is a bbox and not a
 * real polygon, and its known edge-case limitations. */
export function isPointInKurdistanRegion(lat: number, lon: number): boolean {
  return (
    lat >= KURDISTAN_REGION_BBOX.minLat &&
    lat <= KURDISTAN_REGION_BBOX.maxLat &&
    lon >= KURDISTAN_REGION_BBOX.minLon &&
    lon <= KURDISTAN_REGION_BBOX.maxLon
  );
}

export type RegionLabelKey = "kurdistanIraq" | "iraq" | "iran" | "turkey" | "syria";

const COUNTRY_LABEL_KEYS: Record<GazetteerCountry, RegionLabelKey> = {
  IQ: "iraq",
  IR: "iran",
  TR: "turkey",
  SY: "syria",
};

/**
 * Region label key for the place a line is ANCHORED to (ui-backlog.md wave 5
 * item 4): "Kurdistan (Iraq)" when the nearest gazetteer city is flagged
 * `inKurdistanRegion`, otherwise that city's own country. The label names
 * where the CITY is ("12 km N of Khanaqin, Iraq"), never where the epicentre
 * falls, so the same city always carries the same label. (It used to also
 * accept any epicentre inside the KRG bbox, which made Khanaqin read
 * "Khanaqin, Iraq" for one event and "Khanaqin, Kurdistan (Iraq)" for the
 * next, depending on which side of the bbox edge the event fell on.)
 * Callers translate the returned key via `t(\`geo.regions.${key}\`)`.
 */
export function resolveRegionLabelKey(nearestCity: GazetteerCity): RegionLabelKey {
  return nearestCity.inKurdistanRegion
    ? "kurdistanIraq"
    : COUNTRY_LABEL_KEYS[nearestCity.country];
}
