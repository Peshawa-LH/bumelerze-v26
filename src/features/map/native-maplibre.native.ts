import { TurboModuleRegistry } from "react-native";

/**
 * iOS/Android: the MapLibre Native module for the Map tab, or null where its
 * native code is not in this build (Expo Go).
 *
 * This `.native.ts` file is the ONLY place that loads
 * `@maplibre/maplibre-react-native`. The web build resolves
 * `native-maplibre.ts` instead, which returns null, so the package never
 * reaches the web bundle (Expo Router bundles every route file on the web,
 * the native `map.tsx` included, even though the web shows `map.web.tsx`).
 */
export type MapLibreModule = typeof import("@maplibre/maplibre-react-native");

/** MapLibre's map module as registered by a build with its native code. */
const MAPLIBRE_NATIVE_MODULE_NAME = "MLRNMapViewModule";

/** The package's modules look themselves up with `getEnforcing` the moment
 * they are imported, which throws where the native side is missing, so the
 * import stays behind the registry check. */
export function loadNativeMapLibre(): MapLibreModule | null {
  try {
    if (TurboModuleRegistry.get(MAPLIBRE_NATIVE_MODULE_NAME) == null) {
      return null;
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- must stay behind the native-module check above
    return require("@maplibre/maplibre-react-native") as MapLibreModule;
  } catch {
    return null;
  }
}
