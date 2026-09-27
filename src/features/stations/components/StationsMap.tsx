import type { LiveStation } from "../types";

export interface StationsMapProps {
  stations: LiveStation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  accessibilityLabel: string;
}

/** Native: no map until the dev build brings the native MapLibre in (same
 * as the Map tab); the screen shows the list instead. */
export function StationsMap(_props: StationsMapProps) {
  return null;
}
