/**
 * Terrain hillshade — works with EITHER style provider, no API key needed.
 * Source: AWS Open Data Terrain Tiles (Mapzen's original elevation
 * dataset, now mirrored by AWS), `terrarium` PNG encoding, which MapLibre
 * decodes natively (`encoding: "terrarium"` on a `raster-dem` source — no
 * custom decode function required).
 */
import type {
  HillshadeLayerSpecification,
  RasterDEMSourceSpecification,
} from "maplibre-gl";

import type { MapColorScheme } from "./style-provider";

/**
 * Deliberately narrower than maplibre-gl's own `LayerSpecification`/
 * `SourceSpecification` unions (plain `string` rather than each type's
 * closed literal union) — these two pure helpers only ever compare `type`
 * against a couple of literals with `===`, which is valid against a plain
 * `string`, and the wider shape means callers (including this module's own
 * tests) can pass plain object literals without fighting TS's no-context
 * string-literal widening on array literals assigned to an intermediate
 * `const`. A real `StyleSpecification`'s `layers`/`sources` are structurally
 * assignable here regardless.
 */
export interface StyleLayerTypeInfo {
  id: string;
  type: string;
}
export interface StyleSourceTypeInfo {
  type: string;
}

export const TERRAIN_DEM_SOURCE_ID = "bumelerze-terrain-dem";
export const TERRAIN_HILLSHADE_LAYER_ID = "bumelerze-terrain-hillshade";

/** Terrarium-encoded PNG tiles, no key/signup (Registry of Open Data on
 * AWS, "Terrain Tiles"). */
export const TERRAIN_TILE_URL_TEMPLATE =
  "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";

/**
 * Attached as the DEM source's own `attribution` string rather than passed
 * to `AttributionControl` as `customAttribution` — MapLibre already
 * collects every active source's `attribution` into the control
 * automatically (`map.web.tsx`'s existing vector-source attribution relies
 * on the same mechanism), and hand-duplicating a credit line there is
 * exactly what caused the double-attribution bug this module's sibling
 * (`config.ts`) documents. One source, one attribution string, no manual
 * bookkeeping.
 */
export const TERRAIN_ATTRIBUTION = "Terrain: Mapzen/AWS Open Data";

/**
 * True when the active style already ships its own `raster-dem` source
 * (MapTiler's outdoor styles do) — in that case we skip adding a second,
 * redundant hillshade layer rather than layering two on top of each other.
 * Provider-agnostic on purpose: this inspects the actual resolved style's
 * sources rather than hardcoding "skip when provider === maptiler", so it
 * keeps working correctly if MapTiler ever changes which of their styles
 * bundle terrain.
 */
export function styleHasRasterDemSource(
  sources: Record<string, StyleSourceTypeInfo> | undefined,
): boolean {
  if (!sources) {
    return false;
  }
  return Object.values(sources).some((source) => source.type === "raster-dem");
}

/** Pure builder — the DEM source spec, independent of color scheme (the
 * elevation data itself doesn't change; only the hillshade layer's paint
 * below is scheme-tuned). */
export function buildTerrainDemSource(): RasterDEMSourceSpecification {
  return {
    type: "raster-dem",
    tiles: [TERRAIN_TILE_URL_TEMPLATE],
    tileSize: 256,
    encoding: "terrarium",
    // Terrain Tiles cover the whole globe at these zooms (Registry of Open
    // Data listing); no need to advertise a narrower `bounds` here even
    // though the app itself only ever fits to the Kurdistan region bbox.
    minzoom: 0,
    maxzoom: 15,
    attribution: TERRAIN_ATTRIBUTION,
  };
}

/**
 * Pure builder — the hillshade layer's paint, tuned per color scheme.
 * MapLibre's `hillshade` layer type has NO generic opacity paint property
 * (verified against the installed maplibre-gl 6.x's own bundled type
 * defs — only `hillshade-exaggeration`, `-shadow-color`, `-highlight-color`,
 * `-accent-color`, `-illumination-*`, `-method`); "subtler in dark mode" is
 * therefore implemented as lower alpha on the shadow/highlight colors PLUS
 * a smaller exaggeration, not a nonexistent opacity paint prop.
 */
export function buildTerrainHillshadeLayer(
  scheme: MapColorScheme,
): HillshadeLayerSpecification {
  const isDark = scheme === "dark";
  return {
    id: TERRAIN_HILLSHADE_LAYER_ID,
    type: "hillshade",
    source: TERRAIN_DEM_SOURCE_ID,
    paint: {
      "hillshade-exaggeration": isDark ? 0.35 : 0.55,
      // Lower alpha in dark mode so the relief reads as a subtle texture
      // rather than muddying the dark basemap's own low-key palette.
      "hillshade-shadow-color": isDark ? "rgba(0, 0, 0, 0.35)" : "rgba(0, 0, 0, 0.55)",
      "hillshade-highlight-color": isDark
        ? "rgba(255, 255, 255, 0.12)"
        : "rgba(255, 255, 255, 0.35)",
      "hillshade-accent-color": isDark ? "rgba(0, 0, 0, 0.25)" : "rgba(0, 0, 0, 0.4)",
    },
  };
}

/**
 * Robust insertion strategy: MapLibre style layers are painted bottom→top
 * in array order, and vector styles conventionally order fills (land,
 * water, landcover) first, then lines (roads, borders), then symbols
 * (labels). Inserting the hillshade layer immediately before the FIRST
 * line-or-symbol layer puts it above every fill (so relief is visible
 * everywhere land is drawn) but below every road and label (so it never
 * obscures them) — without needing to hardcode any style-specific layer
 * id, so it works across both providers and any future style swap.
 *
 * Returns `undefined` when the style has no line/symbol layer at all (style
 * is fill-only) — callers should treat that as "append on top", the only
 * sane fallback for a style shaped that unusually.
 */
export function findHillshadeBeforeLayerId(
  layers: readonly StyleLayerTypeInfo[],
): string | undefined {
  const target = layers.find((layer) => layer.type === "line" || layer.type === "symbol");
  return target?.id;
}
