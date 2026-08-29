export interface MapCoordinatePickerProps {
  /** Current coordinate parsed from the form's own text fields, or `null`
   * if they're empty/invalid — becomes the map's initial view when a real
   * map exists (`.web.tsx`). Unused on native (see below). */
  initialLat: number | null;
  initialLon: number | null;
  /** Fires once the engineer confirms a point picked on the map. Unused on
   * native (see below). */
  onSelect: (lat: number, lon: number) => void;
}

/**
 * Native default: renders nothing. There is no native MapLibre map in this
 * app yet (`app/(tabs)/map.tsx`'s own placeholder explains why: the native
 * module needs a dev build, which needs the owner's Expo account). Rather
 * than show a "pick on the map" button that opens a broken/placeholder
 * screen, or fake a map with no real basemap, this entry point is simply
 * absent on native — `CoordinateInputForm` still has manual entry, "use my
 * location", and "pick a town instead" (`InlineTownPicker`), which already
 * work everywhere and fully cover the native case. `.web.tsx` is the real,
 * MapLibre-backed picker, following this repo's existing platform-split
 * convention (`map.tsx` / `map.web.tsx`) instead of a runtime `Platform.OS`
 * branch.
 */
export function MapCoordinatePicker(_props: MapCoordinatePickerProps): null {
  return null;
}
