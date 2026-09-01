/**
 * The one shared place a `maplibre-gl` consumer dynamically `import()`s
 * the package and primes its two required-before-any-`new Map()` globals —
 * the worker URL (`MAP_WORKER_URL`, `config.ts`'s own doc comment) and the
 * RTL text-shaping plugin (`rtl-plugin.ts`). Factored out of the Map tab
 * (`app/(tabs)/map.web.tsx`, whose own version of this stayed inline
 * rather than being refactored to call this — lower risk than touching
 * that already-heavily-tested file for a wave that doesn't need to) so a
 * SECOND embedded map (`ShakeMapView.web.tsx`, Event Detail) gets the
 * exact same two guarantees without duplicating either rule:
 *
 *  - `setWorkerUrl` runs before the module resolves, every time — it's
 *    idempotent (safe to call again for a second map instance/session).
 *  - `ensureRTLTextPluginLoaded` only ever calls `setRTLTextPlugin` once
 *    per page session (`shouldRequestRTLTextPlugin`'s own idempotency
 *    guard — a second call throws otherwise), so a second map on the same
 *    page (or the same map recreated by a runtime style fallback) never
 *    hits the "cannot be called multiple times" error.
 */
import { MAP_RTL_TEXT_PLUGIN_URL, MAP_WORKER_URL } from "./config";
import { shouldRequestRTLTextPlugin } from "./rtl-plugin";

export type MapLibreModule = typeof import("maplibre-gl");

/**
 * Requests the RTL plugin — safe to call from every map-creation path,
 * every time, since `shouldRequestRTLTextPlugin` no-ops once the plugin
 * has already been requested this page session. `lazy: true`: the plugin
 * script itself is only fetched once the map actually encounters RTL
 * text, so a session that never switches to `ckb`/`ar` never pays that
 * download. Fire-and-forget with a swallowed `.catch` — a failed plugin
 * fetch (offline, blocked request) degrades to unshaped Arabic-script
 * labels, never a crashed map.
 */
export function ensureRTLTextPluginLoaded(maplibre: MapLibreModule): void {
  if (shouldRequestRTLTextPlugin(maplibre.getRTLTextPluginStatus())) {
    maplibre.setRTLTextPlugin(MAP_RTL_TEXT_PLUGIN_URL, true).catch(() => {
      // Swallowed: see doc comment above.
    });
  }
}

/**
 * Lazily `import()`s `maplibre-gl` and primes it — the ONE call every
 * caller should make instead of a bare `import("maplibre-gl")`. Resolves
 * to the loaded module, ready for `new maplibre.Map(...)`; every
 * subsequent call (a second map instance, a runtime style-fallback
 * recreation) resolves from Node/Metro's own module cache instantly and
 * still safely re-primes both globals (both are no-ops on a repeat call,
 * per the doc comments above).
 */
export function loadMapLibre(): Promise<MapLibreModule> {
  return import("maplibre-gl").then((maplibre) => {
    maplibre.setWorkerUrl(MAP_WORKER_URL);
    ensureRTLTextPluginLoaded(maplibre);
    return maplibre;
  });
}
