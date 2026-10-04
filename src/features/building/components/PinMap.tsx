import type { PinPoint, PinStart } from "../pin";

export interface PinMapProps {
  /** Where the pin and the map start. */
  start: PinStart;
  /** Called whenever the user taps the map or finishes dragging the pin. */
  onPoint: (point: PinPoint) => void;
  accessibilityLabel: string;
}

/** Native: there is no map until the dev build brings the native MapLibre in
 * (same as the Map tab), so "Place on map" is not offered; the location step
 * keeps "Use my location" and the town list. */
export const PIN_MAP_AVAILABLE = false;

export function PinMap(_props: PinMapProps) {
  return null;
}
