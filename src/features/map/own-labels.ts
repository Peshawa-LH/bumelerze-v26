/**
 * Kurdistan city labels drawn from OUR OWN gazetteer (`@/features/geo`)
 * rather than the basemap's vector tiles — owner feedback (2026-08-17): "in
 * Kurdish the names are not correctly rendered". Even with RTL shaping
 * fixed (`rtl-plugin.ts`) and the general `name:ar` coalesce (`labels.ts`)
 * applied, OpenMapTiles-schema vector tiles (both OpenFreeMap's and
 * MapTiler's) very rarely carry a `name:ckb` field at all — Sorani isn't
 * one of OpenMapTiles' supported name languages (`labels.ts`'s doc comment
 * already establishes `ar` is; `ckb` is not, verified against the same
 * upstream `openmaptiles.yaml` `languages:` block). So for Sorani there is
 * no tile-provided name to coalesce onto in the first place — the ONLY way
 * to show a real Sorani city name is to supply it ourselves. The bundled
 * gazetteer (`GAZETTEER_CITIES`) already carries a reviewed-pending Sorani
 * name for every Kurdistan-relevant city (`pickLocalizedName`), so this
 * module turns that into its own GeoJSON symbol layer.
 *
 * Sizing: the gazetteer has no population/importance/tier field on
 * `GazetteerCity` (checked — `gazetteer.ts`'s interface is just
 * `id`/`names`/`lat`/`lon`/`country`/`inKurdistanRegion`), so every city
 * label renders at one uniform size per the wave brief's explicit fallback
 * ("uniform" when no tiering data exists) rather than inventing an
 * unreviewed importance ranking.
 *
 * Avoiding doubled labels (this label layer ABOVE the basemap's own city
 * labels, both showing roughly the same city): rather than editing the
 * basemap style's own label layers (filtering out just the Kurdistan-region
 * cities from THEIR data would mean parsing/rewriting their vector source
 * filters — real complexity for a provider-specific, brittle payoff), this
 * relies on MapLibre's placement engine, which is verified (reading the
 * installed `maplibre-gl` package's own bundled source,
 * `PauseablePlacement.continuePlacement` in `maplibre-gl-dev.mjs`) to run
 * ACROSS every symbol layer in the style through one shared
 * `CollisionIndex`, processed in REVERSE style-layer order — starting at
 * `order.length - 1` (the topmost/last-added layer) and counting down to 0
 * (the bottommost). Concretely: whichever symbol layer is HIGHER in the
 * style's layer stack gets first claim on any given screen position; a
 * lower layer's label that would occupy an already-claimed position is
 * dropped by collision detection. Adding this module's layer LAST (appended
 * with no `beforeId`, i.e. on top of every basemap layer, wiring in
 * `map.web.tsx`) therefore makes it place FIRST each frame — for any
 * gazetteer city where the basemap also draws its own place label at
 * essentially the same coordinate, our label's collision box claims that
 * spot first and the basemap's duplicate is the one collision detection
 * drops, with default `text-allow-overlap: false` / `text-ignore-placement:
 * false` on both sides (this layer's explicit values below; basemap layers
 * ship those same MapLibre defaults unless a style author opted out, which
 * neither OpenFreeMap's nor MapTiler's place-label layers do). No filter
 * rewrite of the basemap style needed.
 */
import type { Feature, FeatureCollection, Point } from "geojson";
import type { GeoJSONSourceSpecification, SymbolLayerSpecification } from "maplibre-gl";

import { GAZETTEER_CITIES, pickLocalizedName, type GazetteerCity } from "@/features/geo";

import type { MapColorScheme } from "./style-provider";

export const OWN_LABELS_SOURCE_ID = "bumelerze-own-city-labels";
export const OWN_LABELS_LAYER_ID = "bumelerze-own-city-labels-symbol";

/** Reasonably universal fallback if the loaded style has no name-labeling
 * symbol layer at all to borrow a font stack from (`resolveOwnLabelsFont`'s
 * caller in `map.web.tsx`) — "Noto Sans Regular" is the exact font
 * OpenFreeMap's own `label_city` layer uses (verified live against
 * `https://tiles.openfreemap.org/styles/liberty` 2026-08-17) and every
 * OpenMapTiles-schema glyph server (OpenFreeMap's and MapTiler's alike)
 * bundles the full Noto Sans family that both providers' OWN label layers
 * already depend on to render at all. */
export const OWN_LABELS_DEFAULT_FONT: readonly string[] = ["Noto Sans Regular"];

export interface OwnLabelProperties {
  id: string;
  label: string;
  [key: string]: unknown;
}

export type OwnLabelFeature = Feature<Point, OwnLabelProperties>;
export type OwnLabelFeatureCollection = FeatureCollection<Point, OwnLabelProperties>;

/** Same `{minLat,maxLat,minLon,maxLon}` shape as `marker-helpers.ts`'s
 * `RegionBbox` — declared standalone (not imported) so this module has no
 * dependency on which concrete bbox constant a caller passes (mirrors that
 * module's own stated rationale). */
export interface OwnLabelsBbox {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

function isCityWithinBbox(city: GazetteerCity, bbox: OwnLabelsBbox): boolean {
  return (
    city.lat >= bbox.minLat &&
    city.lat <= bbox.maxLat &&
    city.lon >= bbox.minLon &&
    city.lon <= bbox.maxLon
  );
}

/**
 * Builds the GeoJSON feature collection for the own-labels source — one
 * Point feature per gazetteer city within `bbox` (the wave brief: "within/
 * near REGION_BBOX... don't try to relabel the world"), labeled via the
 * SAME `pickLocalizedName` choke point every other gazetteer consumer uses
 * (`geo/nearest.ts`, `geo/place-line.ts`), so a locale switch here can never
 * drift from how the rest of the app localizes these same city names.
 * Pure — callers own deciding WHEN to rebuild (`map.web.tsx`: once at load,
 * then again on every locale change, via `GeoJSONSource.setData`).
 */
export function buildOwnLabelFeatureCollection(
  locale: string,
  bbox: OwnLabelsBbox,
  cities: readonly GazetteerCity[] = GAZETTEER_CITIES,
): OwnLabelFeatureCollection {
  return {
    type: "FeatureCollection",
    features: cities
      .filter((city) => isCityWithinBbox(city, bbox))
      .map((city) => ({
        type: "Feature",
        id: city.id,
        properties: { id: city.id, label: pickLocalizedName(city.names, locale) },
        geometry: { type: "Point", coordinates: [city.lon, city.lat] },
      })),
  };
}

/** The `geojson` source spec MapLibre's `map.addSource` expects — a thin,
 * independently-testable wrapper so `map.web.tsx` never hand-builds this
 * shape inline. */
export function buildOwnLabelsSource(
  featureCollection: OwnLabelFeatureCollection,
): GeoJSONSourceSpecification {
  return { type: "geojson", data: featureCollection };
}

/**
 * The symbol layer itself — text-only (no icon; the gazetteer isn't
 * rendering a second dot on top of the basemap's own place markers, just
 * the label). `textFont` is threaded in by the caller (`map.web.tsx`,
 * reading the ACTIVE loaded style's own name-label layer's `text-font` via
 * `getLayoutProperty`) rather than hardcoded here, so glyph availability
 * always matches whichever basemap style/provider is actually live —
 * falls back to `OWN_LABELS_DEFAULT_FONT` only if the style had no
 * name-label layer to borrow from at all.
 *
 * `text-allow-overlap: false` / `text-ignore-placement: false` are
 * MapLibre's own defaults for a symbol layer — set explicitly here (rather
 * than left implicit) because this module's doc comment above depends on
 * them: they're what makes this layer actually PARTICIPATE in (rather than
 * bypass) the shared cross-layer collision index the basemap-label
 * suppression relies on.
 */
export function buildOwnLabelsLayer(
  scheme: MapColorScheme,
  textFont: readonly string[] = OWN_LABELS_DEFAULT_FONT,
): SymbolLayerSpecification {
  const isDark = scheme === "dark";
  return {
    id: OWN_LABELS_LAYER_ID,
    type: "symbol",
    source: OWN_LABELS_SOURCE_ID,
    layout: {
      "text-field": ["get", "label"],
      "text-font": [...textFont],
      "text-size": 13,
      "text-anchor": "top",
      "text-offset": [0, 0.6],
      "text-allow-overlap": false,
      "text-ignore-placement": false,
    },
    paint: {
      // Readable halo, tuned per scheme like `terrain.ts`'s hillshade —
      // light text/dark halo on the dark basemap, dark text/light halo on
      // the light one, the standard high-contrast label convention (not an
      // app-brand color choice; these labels sit over widely varying
      // terrain/land-cover colors underneath, so a brand tint would often
      // lose contrast against them).
      "text-color": isDark ? "#f5f5f5" : "#1a1a1a",
      "text-halo-color": isDark ? "rgba(0, 0, 0, 0.85)" : "rgba(255, 255, 255, 0.85)",
      "text-halo-width": 1.2,
    },
  };
}
