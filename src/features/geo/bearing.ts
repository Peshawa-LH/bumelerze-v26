// Imported from the concrete module, not the `@/features/events` barrel —
// that barrel also re-exports `EventCard`, which itself imports from
// `@/features/geo`, and going through the barrel here would create a
// require-cycle (events -> EventCard -> geo -> events) that breaks under
// Jest's CommonJS module resolution.
import { toRadians } from "@/features/events/distance";

export type DirectionKey = "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW";

/** i18n key for each direction — `bearing8` returns the bare key, callers
 * translate via `t(DIRECTION_I18N_KEYS[key])` (ui-backlog.md wave 5 item 3:
 * "localized direction key ... in all four locales"). */
export const DIRECTION_I18N_KEYS: Record<DirectionKey, string> = {
  N: "geo.directions.n",
  NE: "geo.directions.ne",
  E: "geo.directions.e",
  SE: "geo.directions.se",
  S: "geo.directions.s",
  SW: "geo.directions.sw",
  W: "geo.directions.w",
  NW: "geo.directions.nw",
};

const DIRECTION_KEYS_BY_SECTOR: readonly DirectionKey[] = [
  "N",
  "NE",
  "E",
  "SE",
  "S",
  "SW",
  "W",
  "NW",
];

export interface LatLon {
  lat: number;
  lon: number;
}

function toDegrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

/**
 * Initial great-circle bearing from `from` to `to`, in degrees clockwise
 * from true north (0-360, exclusive of 360 — wraps to 0). Standard forward-
 * azimuth formula; `toRadians` is imported from `events/distance.ts` so
 * this module doesn't re-derive the same trig helper (typescript-
 * react-native.md "one module owns scientific formatting" extended to the
 * shared geodesic primitives, not just their display strings).
 */
export function bearingDegrees(from: LatLon, to: LatLon): number {
  const phi1 = toRadians(from.lat);
  const phi2 = toRadians(to.lat);
  const deltaLambda = toRadians(to.lon - from.lon);

  const y = Math.sin(deltaLambda) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda);

  const theta = Math.atan2(y, x);
  return (toDegrees(theta) + 360) % 360;
}

/**
 * Classifies a bearing into one of 8 compass sectors, each 45° wide and
 * centered on its cardinal/intercardinal direction (e.g. "N" covers
 * [-22.5°, 22.5°)). Returns a direction *key*, not a translated string —
 * see `DIRECTION_I18N_KEYS`.
 */
export function bearing8(from: LatLon, to: LatLon): DirectionKey {
  const degrees = bearingDegrees(from, to);
  const sectorIndex = Math.round(degrees / 45) % DIRECTION_KEYS_BY_SECTOR.length;
  // sectorIndex is always 0-7 (a non-negative value mod 8); the `?? "N"`
  // fallback exists only to satisfy `noUncheckedIndexedAccess`.
  return DIRECTION_KEYS_BY_SECTOR[sectorIndex] ?? "N";
}
