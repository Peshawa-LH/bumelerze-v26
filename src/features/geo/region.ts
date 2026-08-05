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
 * Region label key for an event (ui-backlog.md wave 5 item 4): "Kurdistan
 * (Iraq)" wins either when the nearest gazetteer city is itself flagged
 * `inKurdistanRegion`, OR when the event's own coordinates fall inside the
 * KRG bbox regardless of which city ended up nearest (covers a remote
 * epicenter whose nearest bundled city happens to be an unflagged
 * federally-administered one, e.g. Kirkuk) — otherwise falls back to the
 * nearest city's own country. Callers translate the returned key via
 * `t(\`geo.regions.${key}\`)`.
 */
export function resolveRegionLabelKey(
  nearestCity: GazetteerCity,
  lat: number,
  lon: number,
): RegionLabelKey {
  if (nearestCity.inKurdistanRegion || isPointInKurdistanRegion(lat, lon)) {
    return "kurdistanIraq";
  }
  return COUNTRY_LABEL_KEYS[nearestCity.country];
}
