/**
 * Curated basemap style catalog — the user-visible style picker
 * (update-plan-2026-08.md §4.3/Part 3: "maybe we can have a version where
 * different tunable options for the map are available... we can also keep
 * the final option toggleable between different map styles"). Shipped
 * VISIBLE to every user, not dev-gated (Part 3's explicit instruction) — a
 * map style choice is a normal, welcome feature, and it doubles as the
 * owner's own eyes-on-real-data evaluation tool.
 *
 * Five candidates, each independently verified LIVE (2026-08-17, `curl
 * https://api.maptiler.com/maps/<id>/style.json?key=...` → 200) rather than
 * assumed from docs — the catalog has renamed/retired style ids before
 * (`style-provider.ts`'s doc comment: `outdoor-v2` deprecated in favor of
 * `outdoor-v4`):
 *
 * - `outdoor`: `outdoor-v4` / `outdoor-v4-dark` — today's shipped default
 *   (`style-provider.ts`'s `MAPTILER_STYLE_IDS`), kept as the catalog's
 *   default entry too so "no choice made yet" and "today's basemap" stay
 *   the same map.
 * - `topo`: `topo-v4` / `topo-v4-dark` — hillshade + contours like
 *   `outdoor`, plus 3D building extrusions `style-provider.ts` already
 *   documented as the reason it wasn't picked as the DEFAULT (extra
 *   GPU/paint cost on the low-end-Android baseline) — still a legitimate
 *   candidate for the owner/users to see and choose for themselves.
 * - `hybrid`: satellite imagery + place/road/border label layers. ONE style
 *   id for both color schemes — satellite imagery has no day/night variant,
 *   unlike every vector style here.
 * - `dataviz`: `dataviz-v4` / `dataviz-v4-dark` — the flat, minimal
 *   thematic-data style `style-provider.ts` already documented as a
 *   legitimate lighter-weight alternative (no hillshade/contour layers),
 *   now offered directly instead of only living in a code comment.
 * - `openfreemap`: the existing free, no-API-key basemap (`liberty`/`dark`,
 *   `config.ts`) — always available even with no MapTiler key configured,
 *   and MapTiler-attribution-free (`attribution.ts`'s logo only shows for
 *   an active MapTiler style).
 *
 * Each entry resolves through the SAME MapTiler-key/`forceProvider`
 * contract `style-provider.ts` already uses for the app's default style
 * (`resolveCatalogMapStyle` below) — picking a MapTiler-family entry with no
 * key configured (or after the runtime fallback latch trips) degrades to
 * the OpenFreeMap tiles rather than a broken map, exactly like the existing
 * automatic MapTiler→OpenFreeMap fallback.
 */
import { MAP_STYLE_URLS } from "./config";
import {
  buildMapTilerStyleUrl,
  type MapColorScheme,
  type MapStyleProviderId,
  type ResolvedMapStyle,
} from "./style-provider";

export type MapStyleCatalogId = "outdoor" | "topo" | "hybrid" | "dataviz" | "openfreemap";

/** Display/menu order — `outdoor` first as today's default, `openfreemap`
 * last as the always-available fallback. */
export const MAP_STYLE_CATALOG_IDS: readonly MapStyleCatalogId[] = [
  "outdoor",
  "topo",
  "hybrid",
  "dataviz",
  "openfreemap",
];

export const DEFAULT_MAP_STYLE_CATALOG_ID: MapStyleCatalogId = "outdoor";

/** i18n label-key for each catalog id (`map.style.<id>` in every locale
 * catalog) — one source of truth shared by the picker component and its
 * tests. */
export const MAP_STYLE_LABEL_KEYS: Record<MapStyleCatalogId, string> = {
  outdoor: "map.style.outdoor",
  topo: "map.style.topo",
  hybrid: "map.style.hybrid",
  dataviz: "map.style.dataviz",
  openfreemap: "map.style.openfreemap",
};

interface MapTilerStyleFamily {
  kind: "maptiler";
  light: string;
  dark: string;
}
interface OpenFreeMapStyleFamily {
  kind: "openfreemap";
}
type MapStyleFamily = MapTilerStyleFamily | OpenFreeMapStyleFamily;

/** `hybrid` deliberately reuses the SAME style id for both `light`/`dark` —
 * see the module doc comment above (no day/night satellite variant exists). */
const MAP_STYLE_FAMILIES: Record<MapStyleCatalogId, MapStyleFamily> = {
  outdoor: { kind: "maptiler", light: "outdoor-v4", dark: "outdoor-v4-dark" },
  topo: { kind: "maptiler", light: "topo-v4", dark: "topo-v4-dark" },
  hybrid: { kind: "maptiler", light: "hybrid", dark: "hybrid" },
  dataviz: { kind: "maptiler", light: "dataviz-v4", dark: "dataviz-v4-dark" },
  openfreemap: { kind: "openfreemap" },
};

/**
 * Resolves a catalog entry to an actual style URL/provider — a
 * catalog-parameterized twin of `style-provider.ts`'s
 * `resolveMapStyleForKey`, kept as a SEPARATE function (not a shared
 * implementation) so this module has no import-cycle risk with
 * `style-provider.ts` and so `resolveMapStyleForKey`'s own existing tests
 * stay untouched. `map.web.tsx`'s runtime fallback (`decideMapErrorAction`)
 * and its one-shot latch keep working unchanged for a catalog-selected
 * style: both only ever look at the resolved `provider`, never at which
 * catalog id produced it.
 */
export function resolveCatalogMapStyle(
  catalogId: MapStyleCatalogId,
  scheme: MapColorScheme,
  maptilerKey: string | null,
  forceProvider?: MapStyleProviderId,
): ResolvedMapStyle {
  const family = MAP_STYLE_FAMILIES[catalogId];
  const wantsMapTiler = forceProvider !== "openfreemap" && maptilerKey !== null;
  if (wantsMapTiler && maptilerKey && family.kind === "maptiler") {
    const styleId = scheme === "dark" ? family.dark : family.light;
    return { provider: "maptiler", url: buildMapTilerStyleUrl(styleId, maptilerKey) };
  }
  return {
    provider: "openfreemap",
    url: scheme === "dark" ? MAP_STYLE_URLS.dark : MAP_STYLE_URLS.light,
  };
}
