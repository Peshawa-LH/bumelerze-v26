/**
 * Pure helpers for the web map's markers and initial viewport — deliberately
 * separated from `app/(tabs)/map.web.tsx`'s MapLibre wiring so the actual
 * magnitude→radius/color mapping and bbox→bounds math can be unit-tested
 * directly, with no DOM/WebGL involved (wave brief: "no jsdom WebGL").
 */
import { magnitudeTone, type Event, type MagnitudeTone } from "@/features/events";
import {
  MARKER_MAGNITUDE_CEILING,
  MARKER_MAGNITUDE_FLOOR,
  MARKER_MAX_DIAMETER_PX,
  MARKER_MIN_DIAMETER_PX,
} from "./config";

/** Shape of `REGION_BBOX`/`KURDISTAN_REGION_BBOX` — both config modules
 * export a plain `{ minLat, maxLat, minLon, maxLon }` object of this shape;
 * declared standalone (not `typeof REGION_BBOX`) so this module has no
 * dependency on which concrete bbox constant a caller passes in. */
export interface RegionBbox {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

/** One event reduced to exactly what the map needs to place and style a
 * marker — colors/labels are resolved at render time (theme + i18n aren't
 * pure), everything else lives here. */
export interface RegionMapMarker {
  id: string;
  lon: number;
  lat: number;
  magnitudeValue: number;
  tone: MagnitudeTone;
  /** Visible dot diameter in px — the *hit* target is this plus
   * `MARKER_HIT_PADDING_PX` on each side, applied by the caller. */
  diameterPx: number;
}

/**
 * Linear magnitude→diameter interpolation, clamped to
 * `[MARKER_MAGNITUDE_FLOOR, MARKER_MAGNITUDE_CEILING]` before scaling so
 * out-of-range values (a stray negative micro-event, an extreme M8+) never
 * produce a marker smaller than the min or larger than the max.
 */
export function magnitudeToMarkerDiameterPx(magnitudeValue: number): number {
  const clamped = Math.min(
    Math.max(magnitudeValue, MARKER_MAGNITUDE_FLOOR),
    MARKER_MAGNITUDE_CEILING,
  );
  const range = MARKER_MAGNITUDE_CEILING - MARKER_MAGNITUDE_FLOOR;
  const ratio = range === 0 ? 0 : (clamped - MARKER_MAGNITUDE_FLOOR) / range;
  return Math.round(
    MARKER_MIN_DIAMETER_PX + ratio * (MARKER_MAX_DIAMETER_PX - MARKER_MIN_DIAMETER_PX),
  );
}

/**
 * Derives the map's marker data straight from the already-loaded region
 * feed (`useRegionEvents` — no new fetching, wave brief). Color comes from
 * the shared `magnitudeTone` module (EventCard's own accent-stripe logic,
 * design-language.md §3.2: magnitude-only coarse tone, never a real
 * intensity claim) — reused here rather than reinvented, same rule.
 */
export function buildRegionMarkers(events: Event[]): RegionMapMarker[] {
  return events.map((event) => ({
    id: event.id,
    lon: event.lon,
    lat: event.lat,
    magnitudeValue: event.magnitude.value,
    tone: magnitudeTone(event.magnitude.value),
    diameterPx: magnitudeToMarkerDiameterPx(event.magnitude.value),
  }));
}

/**
 * `REGION_BBOX`'s `{minLat,maxLat,minLon,maxLon}` shape converted to
 * MapLibre's `[[west, south], [east, north]]` bounds tuple (lon, lat order —
 * the one thing this conversion has to get right; `Event`/bbox fields are
 * lat/lon order, MapLibre is always lon/lat).
 */
export function regionBboxToLngLatBounds(
  bbox: RegionBbox,
): [[number, number], [number, number]] {
  return [
    [bbox.minLon, bbox.minLat],
    [bbox.maxLon, bbox.maxLat],
  ];
}

/**
 * `#rrggbb` (or shorthand `#rgb`) -> `rgba(r, g, b, alpha)`, for the DOM
 * marker's translucent-halo/opaque-core treatment (`map.web.tsx`'s
 * marker-build effect — "slight transparency in the fill with an opaque
 * core" so overlapping markers stay readable instead of turning into a
 * solid blob). Only ever fed this app's own theme `status.*` hex tokens
 * (`colors.status[marker.tone]`, design-language.md — never a raw literal
 * or the EMS intensity ramp), so a full CSS-color-name/`rgb()`/`hsl()`
 * parser would be scope this doesn't need; falls back to the input
 * unchanged for anything it can't parse as `#rrggbb`/`#rgb` rather than
 * throwing, so a future non-hex token still renders (just opaque) instead
 * of crashing the marker layer.
 */
export function hexToRgba(hex: string, alpha: number): string {
  const normalized = hex.trim();
  const shortMatch = /^#([0-9a-fA-F]{3})$/.exec(normalized);
  const longMatch = /^#([0-9a-fA-F]{6})$/.exec(normalized);

  let r: number;
  let g: number;
  let b: number;
  if (longMatch) {
    const value = longMatch[1] as string;
    r = parseInt(value.slice(0, 2), 16);
    g = parseInt(value.slice(2, 4), 16);
    b = parseInt(value.slice(4, 6), 16);
  } else if (shortMatch) {
    const value = shortMatch[1] as string;
    r = parseInt((value[0] as string).repeat(2), 16);
    g = parseInt((value[1] as string).repeat(2), 16);
    b = parseInt((value[2] as string).repeat(2), 16);
  } else {
    return normalized;
  }
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
