/**
 * The web (and any non-native platform) twin of `NativeMapTab.native.tsx`.
 * The web's Map tab is `app/(tabs)/(map)/map.web.tsx`; this empty stand-in
 * only exists so the native screen's code stays out of the web bundle
 * (Expo Router bundles the native route file `map.tsx` there too).
 */
export function NativeMapTab(): null {
  return null;
}
