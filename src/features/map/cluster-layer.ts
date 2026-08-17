/**
 * GL rendering half of clustering (`clustering.ts` computes WHICH events
 * group into which cluster; this module turns that result into the
 * GeoJSON source + circle/count layers MapLibre actually paints). Same
 * pure-builder/glue split `own-labels.ts`/`terrain.ts` already establish —
 * `map.web.tsx` calls these once at load and again after every basemap
 * style swap (a `setStyle` wipes every source/layer these two modules add,
 * same as terrain/own-labels), and pushes fresh cluster data through via
 * `GeoJSONSource.setData` whenever the clustered set changes (zoom/filter/
 * scope), exactly like the own-labels source does for locale switches.
 *
 * A plain (non-`cluster: true`) GeoJSON source — the clustering decision
 * already happened in `clustering.ts`, so this source just renders
 * whatever cluster features it's handed; MapLibre's own supercluster
 * machinery is never invoked (see `clustering.ts`'s module doc comment for
 * why).
 */
import type { Feature, FeatureCollection, Point } from "geojson";
import type {
  CircleLayerSpecification,
  GeoJSONSourceSpecification,
  SymbolLayerSpecification,
} from "maplibre-gl";

import { localizeDigits } from "@/lib/format-numbers";
import type { RegionBbox } from "./marker-helpers";
import type { ClusterMarkerFeature } from "./clustering";

export const CLUSTER_SOURCE_ID = "bumelerze-event-clusters";
export const CLUSTER_CIRCLE_LAYER_ID = "bumelerze-event-clusters-circle";
export const CLUSTER_COUNT_LAYER_ID = "bumelerze-event-clusters-count";

export interface ClusterFeatureProperties {
  id: string;
  count: number;
  /** Locale-formatted digit string (`localizeDigits`) — precomputed here
   * (rather than at paint-expression time) so the count label respects the
   * app's Eastern Arabic-Indic digit convention for ckb/ar without needing
   * a GL expression that can reach `i18n.language`. */
  countLabel: string;
  radiusPx: number;
  minLon: number;
  maxLon: number;
  minLat: number;
  maxLat: number;
  [key: string]: unknown;
}

export type ClusterGeoFeature = Feature<Point, ClusterFeatureProperties>;
export type ClusterFeatureCollection = FeatureCollection<Point, ClusterFeatureProperties>;

export const EMPTY_CLUSTER_FEATURE_COLLECTION: ClusterFeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

/** Pure — `clusterRegionMarkers`'s cluster features to GeoJSON, localizing
 * each badge's count label for `locale`. */
export function buildClusterFeatureCollection(
  clusters: readonly ClusterMarkerFeature[],
  locale: string,
): ClusterFeatureCollection {
  return {
    type: "FeatureCollection",
    features: clusters.map((cluster) => ({
      type: "Feature",
      id: cluster.id,
      properties: {
        id: cluster.id,
        count: cluster.count,
        countLabel: localizeDigits(String(cluster.count), locale),
        radiusPx: cluster.diameterPx / 2,
        minLon: cluster.bounds.minLon,
        maxLon: cluster.bounds.maxLon,
        minLat: cluster.bounds.minLat,
        maxLat: cluster.bounds.maxLat,
      },
      geometry: { type: "Point", coordinates: [cluster.lon, cluster.lat] },
    })),
  };
}

export function buildClusterSource(
  featureCollection: ClusterFeatureCollection = EMPTY_CLUSTER_FEATURE_COLLECTION,
): GeoJSONSourceSpecification {
  return { type: "geojson", data: featureCollection };
}

/**
 * The cluster badge itself — `circle-radius` reads each feature's own
 * precomputed `radiusPx` property (`buildClusterFeatureCollection`) rather
 * than a data-driven `step`/`interpolate` GL expression re-deriving the
 * same count->size curve `clustering.ts`'s `clusterDiameterPx` already
 * computed, so there is exactly one place that math lives.
 *
 * Colors are theme tokens the CALLER resolves via `useTheme()` and passes
 * in as plain strings (`map.web.tsx`) — this module has no React context of
 * its own, same reasoning `own-labels.ts`'s scheme-tuned paint takes, just
 * threaded through explicit params here instead of a `scheme` enum since
 * the caller already has the exact resolved semantic-token values on hand.
 * Reuses `colors.brand.primary`/`colors.brand.onPrimary` — the SAME
 * "selected/aggregate" pairing already used by `ScopeToggle`/
 * `MapStylePicker`'s active state elsewhere on this screen — rather than
 * inventing a new palette entry (design-language.md's magnitude-vs-
 * intensity rule this app never conflates).
 */
export function buildClusterCircleLayer(
  fillColor: string,
  strokeColor: string,
): CircleLayerSpecification {
  return {
    id: CLUSTER_CIRCLE_LAYER_ID,
    type: "circle",
    source: CLUSTER_SOURCE_ID,
    paint: {
      "circle-radius": ["get", "radiusPx"],
      "circle-color": fillColor,
      "circle-opacity": 0.92,
      "circle-stroke-width": 2,
      "circle-stroke-color": strokeColor,
    },
  };
}

/** The count label — `textFont` threaded in by the caller (the active
 * style's own name-label font, same `resolveOwnLabelsFont` already reads
 * for `own-labels.ts`) so glyph availability for the localized digit
 * strings always matches whichever basemap is live. */
export function buildClusterCountLayer(
  textColor: string,
  textFont: readonly string[],
): SymbolLayerSpecification {
  return {
    id: CLUSTER_COUNT_LAYER_ID,
    type: "symbol",
    source: CLUSTER_SOURCE_ID,
    layout: {
      "text-field": ["get", "countLabel"],
      "text-font": [...textFont],
      "text-size": 13,
      "text-allow-overlap": true,
      "text-ignore-placement": true,
    },
    paint: {
      "text-color": textColor,
    },
  };
}

/**
 * Reads back the four bounds properties `buildClusterFeatureCollection`
 * encoded, from a MapLibre layer-click event's `feature.properties` — the
 * cluster-click-to-zoom handler's only use of the clicked feature
 * (`map.web.tsx`). Manually validated (not zod — this is our OWN
 * round-tripped data, not an external payload, and the shape is four
 * flat numeric fields) rather than trusted as `any`, matching
 * `own-labels.ts`'s `resolveOwnLabelsFont`-style `Array.isArray` guard
 * for the same "cheap, local, still-typed" reasoning.
 */
export function readClusterBoundsFromProperties(properties: unknown): RegionBbox | null {
  if (!properties || typeof properties !== "object") {
    return null;
  }
  const record = properties as Record<string, unknown>;
  const { minLon, maxLon, minLat, maxLat } = record;
  if (
    typeof minLon !== "number" ||
    typeof maxLon !== "number" ||
    typeof minLat !== "number" ||
    typeof maxLat !== "number"
  ) {
    return null;
  }
  return { minLon, maxLon, minLat, maxLat };
}
