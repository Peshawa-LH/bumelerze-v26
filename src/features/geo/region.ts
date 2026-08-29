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

/**
 * Far-field naming (D28 decision 1, `feedback-waves.md` "F6 resolved"): a
 * closed set of translated Flinn-Engdahl region names, used by `placeLine`
 * for any event beyond `NEAREST_CITY_FALLBACK_THRESHOLD_KM`, INSTEAD of the
 * raw provider place string. F-E is a standard 757-region worldwide
 * scheme — EMSC's `flynn_region` and GEOFON/ISC's `EventLocationName`
 * already carry these exact strings as `Event.placeName` (see
 * `normalize.ts`); USGS's `place` field does not (bearing-format prose, e.g.
 * "142 km SSE of Hasaki, Syria"), so USGS far-field events keep today's
 * fallback behaviour by design (`resolveFarFieldRegionKey` simply won't
 * match their strings).
 *
 * These 18 cover every distinct label in the 150k-event regional catalog's
 * `region` column (measured 2026-08-28/29) plus the highest-frequency labels
 * named in the F6 wave brief. New regions are added here incrementally,
 * highest-frequency first, exactly as the wave brief instructs — an
 * unmapped region is not an error, it falls back to the (still bounded,
 * still standard) English F-E name rather than to a coordinate pair or an
 * empty string.
 */
export type FarFieldRegionKey =
  | "turkey"
  | "iranArmeniaAzerbaijanBorder"
  | "iranIraqBorder"
  | "westernIran"
  | "turkeyIranBorder"
  | "northwesternIran"
  | "iraq"
  | "jordanSyria"
  | "caspianSea"
  | "northernAndCentralIran"
  | "easternArabianPeninsula"
  | "iran"
  | "southernIran"
  | "persianGulf"
  | "azerbaijan"
  | "westernArabianPeninsula"
  | "easternTurkey"
  | "northernIran";

/** Keyed by the F-E region string, lowercased and whitespace-trimmed, so
 * the casing inconsistencies already observed in the catalog data (e.g.
 * "western Iran" beside "Western Iran" — the same casing-drift pattern the
 * F5 wave found in magnitude-type codes) resolve to the same translation
 * rather than silently falling through to English. */
const FAR_FIELD_REGION_KEYS: Record<string, FarFieldRegionKey> = {
  turkey: "turkey",
  "iran-armenia-azerbaijan border region": "iranArmeniaAzerbaijanBorder",
  "iran-iraq border region": "iranIraqBorder",
  "western iran": "westernIran",
  "turkey-iran border region": "turkeyIranBorder",
  "northwestern iran": "northwesternIran",
  iraq: "iraq",
  "jordan-syria region": "jordanSyria",
  "caspian sea": "caspianSea",
  "northern and central iran": "northernAndCentralIran",
  "eastern arabian peninsula": "easternArabianPeninsula",
  iran: "iran",
  "southern iran": "southernIran",
  "persian gulf": "persianGulf",
  azerbaijan: "azerbaijan",
  "western arabian peninsula": "westernArabianPeninsula",
  "eastern turkey": "easternTurkey",
  "northern iran": "northernIran",
};

/**
 * Resolves a raw provider/catalog place string to a translated far-field
 * region key, or `null` when it isn't one of the known Flinn-Engdahl
 * labels (either an unmapped F-E region, or USGS's bearing-format prose,
 * which is passed through unchanged by the caller — see the module doc
 * comment above).
 */
export function resolveFarFieldRegionKey(rawPlaceName: string): FarFieldRegionKey | null {
  const normalized = rawPlaceName.trim().toLowerCase();
  return FAR_FIELD_REGION_KEYS[normalized] ?? null;
}
