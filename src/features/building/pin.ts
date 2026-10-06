import type { FlowLocation } from "./flow-state";

/**
 * Pure logic of the "Place on map" choice in the tag flow: where the pin
 * starts, whether the user may confirm it, and the location it becomes. The
 * map itself (`components/PinMap.web.tsx`) only draws and reports points.
 */

export interface PinPoint {
  lat: number;
  lon: number;
}

export type PinStartSource = "gps" | "pin" | "town" | "reference" | "default";

export interface PinStart extends PinPoint {
  source: PinStartSource;
  zoom: number;
}

/** Zoom when the start is already close to the building / only a town. */
export const PIN_ZOOM_CLOSE = 17;
export const PIN_ZOOM_TOWN = 13;

/** 6 decimals is about 10 cm: enough, and stops float noise in the payload. */
export function roundPoint(point: PinPoint): PinPoint {
  const round = (value: number) => Math.round(value * 1e6) / 1e6;
  return { lat: round(point.lat), lon: round(point.lon) };
}

export function isValidPoint(point: PinPoint): boolean {
  return (
    Number.isFinite(point.lat) &&
    Number.isFinite(point.lon) &&
    Math.abs(point.lat) <= 90 &&
    Math.abs(point.lon) <= 180
  );
}

/**
 * Where the pin starts: the point already chosen in the flow (GPS fix, an
 * earlier pin or a place), else the background reference place (nearest main
 * town to the last fix), else the fallback town. Always a valid point.
 */
export function pinStart(
  current: FlowLocation | null,
  reference: { lat: number | null; lon: number | null } | null,
  fallback: PinPoint,
): PinStart {
  if (current && isValidPoint(current)) {
    return {
      lat: current.lat,
      lon: current.lon,
      source: current.quality,
      zoom: current.quality === "town" ? PIN_ZOOM_TOWN : PIN_ZOOM_CLOSE,
    };
  }
  if (
    reference &&
    reference.lat !== null &&
    reference.lon !== null &&
    isValidPoint({ lat: reference.lat, lon: reference.lon })
  ) {
    return {
      lat: reference.lat,
      lon: reference.lon,
      source: "reference",
      zoom: PIN_ZOOM_TOWN,
    };
  }
  return { ...fallback, source: "default", zoom: PIN_ZOOM_TOWN };
}

/**
 * Confirm is allowed once the pin is somewhere the user chose: it started at
 * a GPS fix or an earlier pin, or they moved it. A pin still sitting on a
 * town centre or the fallback is not a placement yet.
 */
export function canConfirmPin(start: PinStart, point: PinPoint): boolean {
  if (!isValidPoint(point)) {
    return false;
  }
  if (start.source === "gps" || start.source === "pin") {
    return true;
  }
  const a = roundPoint(start);
  const b = roundPoint(point);
  return a.lat !== b.lat || a.lon !== b.lon;
}

/** The flow location a confirmed pin becomes. */
export function pinLocation(point: PinPoint): FlowLocation {
  const { lat, lon } = roundPoint(point);
  return { lat, lon, quality: "pin" };
}
