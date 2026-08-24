/**
 * Basemap style *provider* selection — two providers, chosen at runtime:
 *
 * - `"maptiler"`: used when `EXPO_PUBLIC_MAPTILER_KEY` is configured
 *   (`.env.example`). Both the light AND dark styles are now from the same
 *   MapTiler "Outdoor" product family — `outdoor-v4` (light) / `outdoor-v4-
 *   dark` (dark) — verified live 2026-08-17 by fetching both style.json
 *   documents directly (`https://api.maptiler.com/maps/<id>/style.json?key=
 *   ...`, 200 for both): same 170-layer structure, same `glyphs` font
 *   endpoint, and each carries its OWN `raster-dem` source (`terrain-rgb`)
 *   plus contour/landform layers and a `Hillshade` layer — real terrain
 *   relief cartography in both color schemes, not just the light one.
 *
 *   Superseded choice: `dataviz-v4-dark` (owner feedback 2026-08-17: "the
 *   basemap isn't pleasing" — dataviz is MapTiler's deliberately flat,
 *   minimal thematic-data style, with NO raster-dem/hillshade/contour layer
 *   at all, live-verified the same way). Kept below, commented out, as the
 *   documented alternative rather than deleted outright — a legitimate
 *   choice if a future wave wants the flatter/lighter-weight look back
 *   (fewer layers than `outdoor-v4-dark`'s 170) for a data-overlay-heavy
 *   screen (e.g. behind a dense shakemap raster).
 *
 *   Other dark styles probed the same way (live `style.json` fetch,
 *   2026-08-17) and NOT chosen: `backdrop-dark` (does have hillshade/
 *   raster-dem, but MapTiler's own "Backdrop" family is deliberately
 *   sparse/plain — a data-visualization backdrop, not a richly labeled
 *   general basemap); `topo-v4-dark` (has hillshade + contours too, but
 *   also ships `fill-extrusion` 3D building layers — extra GPU/paint cost
 *   this app doesn't want given the low-end-Android/60fps baseline, for a
 *   feature — 3D buildings — nobody asked for); `streets-v4-dark` (no
 *   raster-dem/hillshade at all, same flatness complaint as dataviz).
 * - `"openfreemap"`: today's liberty/dark styles (`config.ts`) — the
 *   default when no key is configured, AND the automatic one-shot fallback
 *   if the MapTiler style ever fails to load (bad key, quota) — see
 *   `decideMapErrorAction` below. The map must never go blank. OpenFreeMap
 *   ships no built-in terrain of its own in either scheme — `terrain.ts`'s
 *   AWS terrarium hillshade is what supplies relief here, in both colors.
 */
import { MAP_STYLE_URLS } from "./config";

export type MapStyleProviderId = "maptiler" | "openfreemap";
export type MapColorScheme = "light" | "dark";

/**
 * MapTiler style ids behind the two style URLs this app requests — kept as
 * named constants (not inlined into the URL builder) so a future style swap
 * is a one-line change with the verification story intact in one place. See
 * the module doc comment above for how these were confirmed.
 */
export const MAPTILER_STYLE_IDS = {
  light: "outdoor-v4",
  dark: "outdoor-v4-dark",
  // Prior choice (owner: "the basemap isn't pleasing" — flat, no terrain of
  // its own). Left here, not deleted, as the documented lighter-weight
  // alternative — see the module doc comment above.
  // dark: "dataviz-v4-dark",
} as const;

function normalizeMapTilerKey(value: string | undefined): string | null {
  return value && value.trim().length > 0 ? value.trim() : null;
}

/**
 * Static (non-dynamic) `process.env` member access, same reasoning as
 * `src/lib/supabase.ts`'s `readSupabaseUrl`/`readSupabaseAnonKey`: Metro's
 * `EXPO_PUBLIC_` inlining and the `expo/no-dynamic-env-var` lint rule both
 * require this exact shape. Read live (not module-load-snapshotted) so
 * tests can flip `process.env.EXPO_PUBLIC_MAPTILER_KEY` between cases.
 */
export function getConfiguredMapTilerKey(): string | null {
  return normalizeMapTilerKey(process.env.EXPO_PUBLIC_MAPTILER_KEY);
}

/** Builds a MapTiler style.json URL for a given style id + key. Pure — no
 * env access — so `resolveMapStyleForKey` below stays fully testable
 * without mutating `process.env`. */
export function buildMapTilerStyleUrl(styleId: string, key: string): string {
  return `https://api.maptiler.com/maps/${styleId}/style.json?key=${key}`;
}

export interface ResolvedMapStyle {
  provider: MapStyleProviderId;
  url: string;
}

/**
 * The actual provider/URL decision, as a pure function of its inputs —
 * `resolveMapStyle` below is the thin env-reading wrapper callers use.
 *
 * `forceProvider: "openfreemap"` is how the runtime fallback path (see
 * `decideMapErrorAction`) pins the *next* map (re)creation to OpenFreeMap
 * even when a MapTiler key is configured, without needing a second code
 * path — the same resolver just gets told not to consider the key this
 * time.
 */
export function resolveMapStyleForKey(
  scheme: MapColorScheme,
  maptilerKey: string | null,
  forceProvider?: MapStyleProviderId,
): ResolvedMapStyle {
  const wantsMapTiler = forceProvider !== "openfreemap" && maptilerKey !== null;
  if (wantsMapTiler && maptilerKey) {
    const styleId =
      scheme === "dark" ? MAPTILER_STYLE_IDS.dark : MAPTILER_STYLE_IDS.light;
    return { provider: "maptiler", url: buildMapTilerStyleUrl(styleId, maptilerKey) };
  }
  return {
    provider: "openfreemap",
    url: scheme === "dark" ? MAP_STYLE_URLS.dark : MAP_STYLE_URLS.light,
  };
}

/** Env-reading wrapper around `resolveMapStyleForKey` — what `map.web.tsx`
 * actually calls. */
export function resolveMapStyle(
  scheme: MapColorScheme,
  forceProvider?: MapStyleProviderId,
): ResolvedMapStyle {
  return resolveMapStyleForKey(scheme, getConfiguredMapTilerKey(), forceProvider);
}

/**
 * Fallback decision for a MapLibre map `"error"` event. Only falls back
 * (MapTiler → OpenFreeMap) when ALL of:
 *  - the active provider is `"maptiler"` (OpenFreeMap has nowhere further
 *    to fall back to — its own failure is the genuine offline/error state);
 *  - the map never reached `"ready"` yet (a style/tile-load failure, not
 *    e.g. a later flaky single tile on an already-showing map — swapping
 *    the whole basemap out from under a user who's already looking at it
 *    would be a worse experience than just showing that one gap);
 *  - a fallback hasn't already been attempted this session (one-shot, no
 *    loop — if OpenFreeMap ALSO errors, that's the real offline state).
 */
export function decideMapErrorAction(input: {
  provider: MapStyleProviderId;
  hasReachedReady: boolean;
  alreadyFellBack: boolean;
}): "fallback-to-openfreemap" | "show-error" {
  if (input.provider === "maptiler" && !input.hasReachedReady && !input.alreadyFellBack) {
    return "fallback-to-openfreemap";
  }
  return "show-error";
}
