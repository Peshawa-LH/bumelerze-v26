/**
 * The iOS/Android twin of `WebMapTab.web.tsx`. The native Map tab is
 * `app/(tabs)/(map)/map.tsx` (`NativeMapTab`). Expo Router bundles the web
 * route file `map.web.tsx` on iOS and Android too; this empty stand-in is
 * what it gets there, so the web map's code and MapLibre GL JS (about 1 MB)
 * stay out of the phone bundle.
 */
export default function WebMapTab(): null {
  return null;
}
