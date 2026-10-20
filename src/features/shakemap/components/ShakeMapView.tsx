import { useMemo } from "react";

import { loadNativeMapLibre } from "@/features/map/native-maplibre";
import { ShakeMapViewNative } from "./ShakeMapViewNative";
import {
  ShakeMapView as ShakeMapViewSvg,
  type ShakeMapViewProps,
} from "./ShakeMapViewSvg";

export type { ShakeMapLayer, ShakeMapViewProps } from "./ShakeMapViewSvg";

/**
 * Native (iOS/Android) entry point of the event page's SHAKEmap: the
 * interactive MapLibre Native map (`ShakeMapViewNative.tsx`, the same map
 * the web draws with maplibre-gl in `ShakeMapView.web.tsx`), or the SVG
 * map (`ShakeMapViewSvg.tsx`) where MapLibre's native code is not in the
 * build (Expo Go, and Jest unless a test says otherwise) or no map can be
 * shown at all.
 *
 * Metro resolves this file for native builds and Jest; the web build takes
 * `ShakeMapView.web.tsx`. `ShakeMapSection.tsx` imports `./ShakeMapView`
 * and never needs to know which one it got. `ShakeMapView.web.tsx` imports
 * `ShakeMapViewSvg` directly for its own fall-back, so there is exactly one
 * SVG implementation on disk.
 */
export function ShakeMapView(props: ShakeMapViewProps) {
  const mapLibre = useMemo(() => loadNativeMapLibre(), []);
  if (!mapLibre) {
    return <ShakeMapViewSvg {...props} />;
  }
  return <ShakeMapViewNative mapLibre={mapLibre} {...props} />;
}
