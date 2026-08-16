/**
 * Basemap style *provider* selection — two providers, chosen at runtime:
 *
 * - `"maptiler"`: used when `EXPO_PUBLIC_MAPTILER_KEY` is configured
 *   (`.env.example`). MapTiler's `outdoor-v4` (light) ships real terrain
 *   relief/contour cartography; `dataviz-v4-dark` (dark) is their minimal
 *   dark thematic style — both verified live against MapTiler's own
 *   `@maptiler/client` reference-style list (`referenceStyleID: "OUTDOOR_V4"`
 *   / `"DATAVIZ_V4"`, fetched from unpkg 2026-08-16; the `-v2`/plain
 *   `dataviz`/`dataviz-dark` ids some older docs/examples use are marked
 *   `deprecationMessage` in that same list — superseded by the `-v4` ids
 *   used here).
 * - `"openfreemap"`: today's liberty/dark styles (`config.ts`) — the
 *   default when no key is configured, AND the automatic one-shot fallback
 *   if the MapTiler style ever fails to load (bad key, quota) — see
 *   `decideMapErrorAction` below. The map must never go blank.
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
  dark: "dataviz-v4-dark",
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
