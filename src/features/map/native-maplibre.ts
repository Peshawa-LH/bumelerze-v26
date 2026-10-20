/**
 * Web (and any non-native platform): there is no MapLibre Native here; the
 * web map is maplibre-gl in `app/(tabs)/(map)/map.web.tsx`. iOS and Android
 * resolve `native-maplibre.native.ts` instead. Keeping this twin free of any
 * runtime reference to `@maplibre/maplibre-react-native` is what keeps the
 * package out of the web bundle.
 */
export type MapLibreModule = typeof import("@maplibre/maplibre-react-native");

export function loadNativeMapLibre(): MapLibreModule | null {
  return null;
}
