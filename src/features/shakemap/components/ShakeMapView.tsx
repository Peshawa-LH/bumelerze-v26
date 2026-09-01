/**
 * Native (iOS/Android) entry point — the SVG projection renderer
 * (`ShakeMapViewSvg.tsx`) is still the only implementation available off
 * web (MapLibre React Native needs a dev build, not set up yet — same
 * reasoning `app/(tabs)/map.tsx`'s own doc comment gives for the Map tab).
 *
 * This file is what `./ShakeMapView` resolves to under Jest (no "web"
 * platform in this repo's default preset — see `ShakeMapView.web.tsx`'s
 * own doc comment) and on native builds; Metro's platform-extension
 * resolution swaps in the sibling `ShakeMapView.web.tsx` automatically for
 * real web builds, exactly like the Map tab's `map.tsx`/`map.web.tsx`
 * pair. `ShakeMapSection.tsx` imports `./ShakeMapView` with no extension
 * either way and never needs to know which one it got.
 *
 * A thin re-export, not a copy — `ShakeMapView.web.tsx` also imports
 * `ShakeMapViewSvg` directly (under an unambiguous name, never
 * `./ShakeMapView`, which would resolve back to itself under Metro's own
 * platform resolution) as its own "MapLibre failed to load" fallback, so
 * there is exactly one SVG implementation on disk either way.
 */
export { ShakeMapView, type ShakeMapLayer, type ShakeMapViewProps } from "./ShakeMapViewSvg";
