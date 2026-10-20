import { NativeMapTab } from "@/features/map/NativeMapTab";

/**
 * Native (iOS/Android) Map tab route: MapLibre Native, in
 * `src/features/map/NativeMapTab.native.tsx`. The web uses `map.web.tsx`.
 * Expo Router bundles this file on the web too, which is why the screen
 * lives behind a `.native.tsx` twin rather than here.
 */
export default function MapScreen() {
  return <NativeMapTab />;
}
