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
 * `id`/`names`/`lat`/`lon`/`country`/`inKurdistanRegion`), so gazetteer
 * cities all render at the same (largest) size — tier 0, see
 * `OwnLabelProperties`.
 *
 * BEYOND THE DOZEN GAZETTEER CITIES (update-plan §4.7, still owner feedback
 * "the Kurdish names are still not good... find a map with actual Kurdish
 * in them"): the gazetteer alone only ever covers its own hand-checked
 * list. OpenStreetMap itself carries real `name:ckb`/`name:ku` tags for
 * thousands of towns and villages across Kurdistan, contributed by Kurdish
 * mappers — `scripts/build-kurdish-places.mjs` extracts, dedups, and tiers
 * those into `@/features/geo/data/kurdish-places-{core,villages}.json`
 * (types/validation/locale-resolution in `@/features/geo/kurdish-places.ts`).
 * `buildMergedOwnLabelFeatureCollection` below merges that dataset with the
 * gazetteer into ONE feature collection — gazetteer wins where the two
 * disagree about the same place (`isNearAnyGazetteerCity`), and everything
 * renders through the SAME layer/collision mechanism described below, just
 * zoom-gated by tier (`KURDISH_PLACE_MIN_ZOOM`) so villages don't clutter a
 * zoomed-out view.
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

// Imported from the concrete module, not the `@/features/events` barrel —
// same require-cycle hazard `geo/bearing.ts`/`geo/nearest.ts` already
// document (that barrel re-exports `EventCard`, which imports from
// `@/features/geo`).
import { haversineDistanceKm } from "@/features/events/distance";
import {
  GAZETTEER_CITIES,
  parseKurdishPlaces,
  pickLocalizedName,
  resolveKurdishPlaceName,
  type GazetteerCity,
  type KurdishPlace,
  type KurdishPlaceTier,
} from "@/features/geo";
import kurdishPlacesCoreRaw from "@/features/geo/data/kurdish-places-core.json";

import type { MapColorScheme } from "./style-provider";

export const OWN_LABELS_SOURCE_ID = "bumelerze-own-city-labels";
export const OWN_LABELS_LAYER_ID = "bumelerze-own-city-labels-symbol";

/** OpenStreetMap attribution for the Kurdish-places dataset
 * (`@/features/geo/data/kurdish-places-*.json`, built by
 * `scripts/build-kurdish-places.mjs`) — ODbL requires it (`DATA-SOURCES.md`
 * §4). Set as this source's own `attribution`, the same mechanism the
 * basemap's vector-tile source already uses (its TileJSON's `attribution`
 * string) — `map.web.tsx`'s `AttributionControl` collects every active
 * source's `attribution` automatically, so this needs no separate,
 * hand-typed credit line to keep in sync. */
export const OWN_LABELS_ATTRIBUTION =
  "Kurdish place names © OpenStreetMap contributors (ODbL)";

/** Tier 1-2 (city/town/suburb) — small (under 100KB), loaded unconditionally
 * alongside the gazetteer since every own-labels consumer needs it. Tier 3
 * (village/hamlet, the bulk of the dataset) is deliberately NOT statically
 * imported here — `map.web.tsx` loads it via a lazy `import()`, mirroring
 * how that file already lazy-loads `maplibre-gl` itself, so a session that
 * never opens the Map tab never pays for either. `parseKurdishPlaces`
 * validates the shape at load (typescript-react-native.md's IO-boundary
 * rule) — a build-script/schema drift fails loudly here, at module load,
 * not as a silently blank label on the map. */
export const KURDISH_PLACES_CORE: readonly KurdishPlace[] =
  parseKurdishPlaces(kurdishPlacesCoreRaw);

/** Minimum zoom each Kurdish-place tier starts rendering at (wave brief:
 * "zoom-tiered so cities appear early and villages only at close zoom").
 * Tunable engineering defaults (PROJECT.md D14: no science review needed):
 * tier 1 (city) matches the gazetteer's own always-visible treatment (0);
 * tier 2 (town/suburb) appears once a user has zoomed in enough to be
 * looking at a specific area, not the whole region; tier 3 (village/
 * hamlet) — by far the largest tier — only once they're zoomed in close
 * enough that a few thousand possible symbols in view is no longer a
 * meaningful cost (MapLibre's GeoJSON source is itself internally tiled,
 * so even at tier 3's zoom this only evaluates symbols in the current
 * viewport, never the whole dataset at once). */
export const KURDISH_PLACE_MIN_ZOOM: Record<KurdishPlaceTier, number> = {
  1: 0,
  2: 7,
  3: 10,
};

/** Radius within which a Kurdish-places entry is treated as "the same
 * place" as a gazetteer city, and dropped (wave brief: "gazetteer names
 * winning on conflict since those are hand-checked"). 5km comfortably
 * covers the gap between the gazetteer's approximate town centroids
 * (`gazetteer.ts`'s own doc comment: "approximate town centroids, not
 * surveyed points") and OSM's more precise point placements for the SAME
 * city — verified against the live dataset: every gazetteer city that also
 * has an OSM tier-1/2 counterpart (Erbil, Duhok, Kirkuk, Mosul, Baghdad,
 * Halabja, Kelar, ...) lands well under 2km apart — while still being far
 * short of the ~10km+ gap to the next real, DISTINCT town, so a genuinely
 * different nearby place is never wrongly suppressed. */
export const GAZETTEER_CONFLICT_RADIUS_KM = 5;

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
  /** 0 = hand-checked gazetteer city; 1-3 = the OSM-derived Kurdish-places
   * tier (`KurdishPlaceTier`). Drives `buildOwnLabelsLayer`'s per-tier
   * `text-size`. */
  tier: number;
  /** The zoom this feature's layer `filter` requires before it's eligible
   * to render at all (`KURDISH_PLACE_MIN_ZOOM`, or 0 for gazetteer
   * cities/OSM tier-1 cities) — a per-FEATURE property rather than a
   * layer-level `minzoom` because tiers are mixed within one source/layer
   * (wave brief: "cities appear early and villages only at close zoom",
   * all in the same label layer so they keep participating in the same
   * cross-layer collision index — see the module doc comment above). */
  minzoom: number;
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

function isPointWithinBbox(
  point: { lat: number; lon: number },
  bbox: OwnLabelsBbox,
): boolean {
  return (
    point.lat >= bbox.minLat &&
    point.lat <= bbox.maxLat &&
    point.lon >= bbox.minLon &&
    point.lon <= bbox.maxLon
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
 *
 * Gazetteer-only — see `buildMergedOwnLabelFeatureCollection` below for the
 * version that also merges in the OSM-derived Kurdish-places dataset. Kept
 * as its own function (not folded into the merged builder) because it has
 * no async/lazy-loading concerns of its own and is simple to unit-test in
 * isolation; the merged builder calls this one internally.
 */
export function buildOwnLabelFeatureCollection(
  locale: string,
  bbox: OwnLabelsBbox,
  cities: readonly GazetteerCity[] = GAZETTEER_CITIES,
): OwnLabelFeatureCollection {
  return {
    type: "FeatureCollection",
    features: buildGazetteerFeatures(locale, bbox, cities),
  };
}

function buildGazetteerFeatures(
  locale: string,
  bbox: OwnLabelsBbox,
  cities: readonly GazetteerCity[],
): OwnLabelFeature[] {
  return cities
    .filter((city) => isPointWithinBbox(city, bbox))
    .map((city) => ({
      type: "Feature",
      id: city.id,
      properties: {
        id: city.id,
        label: pickLocalizedName(city.names, locale),
        tier: 0,
        minzoom: 0,
      },
      geometry: { type: "Point", coordinates: [city.lon, city.lat] },
    }));
}

/** True when `place` sits within `GAZETTEER_CONFLICT_RADIUS_KM` of ANY
 * gazetteer city in `gazetteerCities` — the "same physical place, gazetteer
 * wins" check (`GAZETTEER_CONFLICT_RADIUS_KM`'s doc comment). `O(places ×
 * gazetteerCities)`; both sides are small (low thousands × a few dozen) so
 * this runs in low-single-digit milliseconds even at the full dataset's
 * size — see own-labels.test.ts's performance-budget assertion. */
function isNearAnyGazetteerCity(
  place: { lat: number; lon: number },
  gazetteerCities: readonly GazetteerCity[],
): boolean {
  return gazetteerCities.some(
    (city) =>
      haversineDistanceKm(city.lat, city.lon, place.lat, place.lon) <=
      GAZETTEER_CONFLICT_RADIUS_KM,
  );
}

/**
 * Builds the OSM-derived Kurdish-places half of the merged feature set:
 * within `bbox`, NOT conflicting with a gazetteer city (`isNearAnyGazetteerCity`),
 * and only where `resolveKurdishPlaceName` actually finds a name for
 * `locale` (a record can carry ckb/ar but not kmr, say — such a record is
 * simply skipped for a `kmr`-locale render rather than drawing a blank
 * label or falling back to a different language silently).
 */
function buildKurdishPlaceFeatures(
  locale: string,
  bbox: OwnLabelsBbox,
  kurdishPlaces: readonly KurdishPlace[],
  gazetteerCities: readonly GazetteerCity[],
): OwnLabelFeature[] {
  const gazetteerCitiesInBbox = gazetteerCities.filter((city) =>
    isPointWithinBbox(city, bbox),
  );
  const features: OwnLabelFeature[] = [];
  for (const place of kurdishPlaces) {
    if (!isPointWithinBbox(place, bbox)) continue;
    if (isNearAnyGazetteerCity(place, gazetteerCitiesInBbox)) continue;
    const label = resolveKurdishPlaceName(place.names, locale);
    if (!label) continue;
    features.push({
      type: "Feature",
      id: place.id,
      properties: {
        id: place.id,
        label,
        tier: place.tier,
        minzoom: KURDISH_PLACE_MIN_ZOOM[place.tier],
      },
      geometry: { type: "Point", coordinates: [place.lon, place.lat] },
    });
  }
  return features;
}

/**
 * The merged own-labels feature collection: hand-checked gazetteer cities
 * (tier 0, always shown) PLUS the OSM-derived Kurdish-places dataset
 * (tiers 1-3, zoom-gated, gazetteer wins on conflict) — this is what
 * `map.web.tsx` actually feeds the map (`buildOwnLabelFeatureCollection`
 * above stays gazetteer-only, used internally and directly unit-tested).
 *
 * `kurdishPlaces` defaults to `KURDISH_PLACES_CORE` (tier 1-2 only, always
 * bundled) — `map.web.tsx` passes `[...KURDISH_PLACES_CORE, ...villages]`
 * once its lazy `import()` of the tier-3 village dataset resolves, and
 * calls this again to refresh the source. This module has no lazy-loading
 * logic of its own — that stays MapLibre-API/network glue in `map.web.tsx`,
 * per this file's established pure/tested-vs-glue split.
 */
export function buildMergedOwnLabelFeatureCollection(
  locale: string,
  bbox: OwnLabelsBbox,
  gazetteerCities: readonly GazetteerCity[] = GAZETTEER_CITIES,
  kurdishPlaces: readonly KurdishPlace[] = KURDISH_PLACES_CORE,
): OwnLabelFeatureCollection {
  return {
    type: "FeatureCollection",
    features: [
      ...buildGazetteerFeatures(locale, bbox, gazetteerCities),
      ...buildKurdishPlaceFeatures(locale, bbox, kurdishPlaces, gazetteerCities),
    ],
  };
}

/** The `geojson` source spec MapLibre's `map.addSource` expects — a thin,
 * independently-testable wrapper so `map.web.tsx` never hand-builds this
 * shape inline. Carries `OWN_LABELS_ATTRIBUTION` as this source's own
 * `attribution` (see that constant's doc comment for why that's the
 * mechanism, not a hand-typed credit line elsewhere). */
export function buildOwnLabelsSource(
  featureCollection: OwnLabelFeatureCollection,
): GeoJSONSourceSpecification {
  return {
    type: "geojson",
    data: featureCollection,
    attribution: OWN_LABELS_ATTRIBUTION,
  };
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
 * suppression relies on. That mechanism is a property of LAYER ORDER, not
 * feature count, so it holds unchanged now that this one layer/source
 * carries thousands of Kurdish-places features instead of a dozen
 * gazetteer cities — MapLibre still runs its collision index across every
 * symbol layer's CURRENTLY RENDERED features (already zoom-filtered by
 * `filter` below, and further culled to the current viewport by the
 * source's own internal tiling), not the whole source at once.
 *
 * ONE filter/layout applies to every tier — `filter` reads each feature's
 * own `minzoom` property (`KURDISH_PLACE_MIN_ZOOM`) rather than this being
 * several separate layers per tier, so every tier keeps participating in
 * the SAME collision index/z-order (splitting into per-tier layers would
 * reintroduce the exact doubled-label risk this file's collision strategy
 * exists to avoid). `text-size` is a `["step", ["get","tier"], ...]`
 * data-driven expression — larger for hand-checked gazetteer/OSM cities
 * (tier 0/1), progressively smaller for town/suburb (2) and village/hamlet
 * (3), a standard cartographic size-by-importance cue.
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
    filter: [">=", ["zoom"], ["get", "minzoom"]],
    layout: {
      "text-field": ["get", "label"],
      "text-font": [...textFont],
      "text-size": ["step", ["get", "tier"], 15, 1, 14, 2, 13, 3, 12],
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
