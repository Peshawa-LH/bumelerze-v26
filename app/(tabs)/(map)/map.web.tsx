/**
 * Web Map tab route: MapLibre GL JS, in `src/features/map/WebMapTab.web.tsx`.
 * Expo Router bundles this file on iOS and Android too, where
 * `@/features/map/WebMapTab` resolves to an empty twin, so the web map and
 * `maplibre-gl` never reach the phone bundle (the phone's Map tab is
 * `map.tsx`).
 */
export { default } from "@/features/map/WebMapTab";
