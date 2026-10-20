/**
 * The web map's layer specs in the form MapLibre Native wants (iOS/Android).
 *
 * The web adds sources and layers one by one through maplibre-gl's
 * `addSource`/`addLayer`. MapLibre React Native 11 declares them as
 * elements instead: `<GeoJSONSource>`, `<ImageSource>`, `<RasterDEMSource>`
 * and `<Layer>`, whose props are the same MapLibre style JSON. This module
 * turns the SAME specs (`layer-registry.ts`, `own-labels.ts`, `terrain.ts`)
 * into those props, so both platforms draw from one definition, and holds
 * the event-marker mapping the native map uses in place of the web's DOM
 * markers.
 *
 * Pure and platform-neutral: no MapLibre import of either kind (the native
 * files must never pull in `maplibre-gl`), unit-tested in
 * `__tests__/native-layers.test.ts`.
 */
import type { Feature, FeatureCollection, Point } from "geojson";

import type { MagnitudeTone } from "@/features/events/magnitude-tone";

import {
  buildOverlaySpec,
  isOverlayOn,
  OVERLAY_STACK,
  overlayDataUrl,
  type MapOverlayState,
  type OverlayLayerId,
} from "./layer-registry";
import type { RegionMapMarker } from "./marker-helpers";
import { toMapLibreNativeLabel } from "./native-label-text";
import type { OwnLabelFeatureCollection } from "./own-labels";

/** The parts of a style-spec layer this module reads. Structural, so the
 * web builders' maplibre-gl types are assignable without importing them. */
export interface StyleLayerSpecLike {
  id: string;
  type: string;
  source?: string;
  "source-layer"?: string;
  filter?: unknown;
  minzoom?: number;
  maxzoom?: number;
  layout?: object;
  paint?: object;
}

/** Props for MapLibre React Native's `<Layer>`: the style-spec layer plus
 * where it goes in the style (`beforeId`: drawn under that layer). */
export interface NativeLayerProps {
  id: string;
  type: string;
  source?: string;
  "source-layer"?: string;
  filter?: unknown;
  minzoom?: number;
  maxzoom?: number;
  layout?: Record<string, unknown>;
  paint?: Record<string, unknown>;
  beforeId?: string;
}

/**
 * A style-spec layer as `<Layer>` props. Keys the spec leaves out stay out
 * (the native side treats a present-but-undefined key as a value), and
 * `beforeId` is set only when there is a layer to go under.
 */
export function toNativeLayerProps(
  spec: StyleLayerSpecLike,
  beforeId?: string,
): NativeLayerProps {
  const props: NativeLayerProps = { id: spec.id, type: spec.type };
  if (spec.source !== undefined) props.source = spec.source;
  if (spec["source-layer"] !== undefined) props["source-layer"] = spec["source-layer"];
  if (spec.filter !== undefined) props.filter = spec.filter;
  if (spec.minzoom !== undefined) props.minzoom = spec.minzoom;
  if (spec.maxzoom !== undefined) props.maxzoom = spec.maxzoom;
  if (spec.layout !== undefined) props.layout = { ...spec.layout };
  if (spec.paint !== undefined) props.paint = { ...spec.paint };
  if (beforeId !== undefined) props.beforeId = beforeId;
  return props;
}

/** The style-spec source kinds the native maps use. */
export type SourceSpecLike =
  | { type: "geojson"; data: unknown; attribution?: string }
  | {
      type: "image";
      url: string;
      coordinates: readonly (readonly [number, number])[] | number[][];
    }
  | {
      type: "raster-dem";
      tiles?: string[];
      url?: string;
      tileSize?: number;
      encoding?: "mapbox" | "terrarium" | "custom";
      minzoom?: number;
      maxzoom?: number;
      attribution?: string;
    };

type LngLatTuple = [number, number];

/** A source as the props of the matching MapLibre React Native element. */
export type NativeSourceProps =
  | { kind: "geojson"; id: string; data: string | object }
  | {
      kind: "image";
      id: string;
      url: string;
      coordinates: [LngLatTuple, LngLatTuple, LngLatTuple, LngLatTuple];
    }
  | {
      kind: "raster-dem";
      id: string;
      tiles: string[];
      tileSize: number;
      encoding: "mapbox" | "terrarium";
      minzoom: number;
      maxzoom: number;
      attribution?: string;
    };

function toLngLat(point: readonly number[] | undefined): LngLatTuple {
  return [point?.[0] ?? 0, point?.[1] ?? 0];
}

/**
 * A style-spec source as native element props, or `null` for a source this
 * app never declares natively (a vector source, an image without its four
 * corners). GeoJSON data passes through as given: a URL string the native
 * side downloads (and keeps in MapLibre's offline cache), or an object.
 */
export function toNativeSource(
  id: string,
  spec: SourceSpecLike,
): NativeSourceProps | null {
  switch (spec.type) {
    case "geojson":
      if (
        typeof spec.data === "string" ||
        (spec.data !== null && typeof spec.data === "object")
      ) {
        return { kind: "geojson", id, data: spec.data as string | object };
      }
      return null;
    case "image": {
      if (spec.coordinates.length !== 4) return null;
      const [topLeft, topRight, bottomRight, bottomLeft] = spec.coordinates;
      return {
        kind: "image",
        id,
        url: spec.url,
        coordinates: [
          toLngLat(topLeft),
          toLngLat(topRight),
          toLngLat(bottomRight),
          toLngLat(bottomLeft),
        ],
      };
    }
    case "raster-dem": {
      if (!spec.tiles || spec.tiles.length === 0) return null;
      const props: NativeSourceProps = {
        kind: "raster-dem",
        id,
        tiles: [...spec.tiles],
        tileSize: spec.tileSize ?? 512,
        encoding: spec.encoding === "terrarium" ? "terrarium" : "mapbox",
        minzoom: spec.minzoom ?? 0,
        maxzoom: spec.maxzoom ?? 22,
      };
      if (spec.attribution !== undefined) props.attribution = spec.attribution;
      return props;
    }
  }
}

/** One switched-on context layer, ready to declare. */
export interface NativeOverlay {
  id: OverlayLayerId;
  source: NativeSourceProps;
  /** Bottom to top. */
  layers: NativeLayerProps[];
}

/** The invisible placeholder layer an overlay is drawn under
 * (`native-style.ts`'s `insertAnchorLayers`). */
export function overlayAnchorLayerId(id: OverlayLayerId): string {
  return `bumelerze-anchor-${id}`;
}

/** Every overlay's placeholder, bottom of `OVERLAY_STACK` first: what the
 * native Map tab asks `prepareNativeMapStyle` to add under the labels. */
export const NATIVE_OVERLAY_ANCHOR_IDS: readonly string[] =
  OVERLAY_STACK.map(overlayAnchorLayerId);

/**
 * The switched-on overlays (Layers panel) as native sources and layers,
 * bottom of `OVERLAY_STACK` first, reading the files the web app serves
 * from `origin`.
 *
 * Stacking matches the web's `applyMapOverlay` (every overlay under the
 * basemap's labels, the stack order kept whatever was switched on first),
 * but by a fixed `beforeId` per overlay, its own placeholder layer, which
 * the style document carries in stack order. A `beforeId` that changed
 * with the other toggles would make MapLibre React Native drop the layer
 * (see `insertAnchorLayers`).
 */
export function buildNativeOverlays(
  overlays: MapOverlayState,
  scheme: "light" | "dark",
  options: { origin: string },
): NativeOverlay[] {
  const result: NativeOverlay[] = [];
  for (const id of OVERLAY_STACK) {
    if (!isOverlayOn(overlays, id)) continue;
    const spec = buildOverlaySpec(id, scheme, overlayDataUrl(id, options.origin));
    const source = toNativeSource(spec.sourceId, spec.source as SourceSpecLike);
    if (!source) continue;
    const beforeId = overlayAnchorLayerId(id);
    result.push({
      id,
      source,
      layers: spec.layers.map((layer) =>
        toNativeLayerProps(layer as StyleLayerSpecLike, beforeId),
      ),
    });
  }
  return result;
}

/**
 * The own Kurdish place labels (`own-labels.ts`) with every label passed
 * through `toMapLibreNativeLabel`, so Sorani letters MapLibre Native's
 * shaper does not know still join (see that module).
 */
export function toNativeOwnLabels(
  collection: OwnLabelFeatureCollection,
): OwnLabelFeatureCollection {
  return {
    type: "FeatureCollection",
    features: collection.features.map((feature) => ({
      ...feature,
      properties: {
        ...feature.properties,
        label: toMapLibreNativeLabel(feature.properties.label),
      },
    })),
  };
}

// ---------------------------------------------------------------------------
// Event markers
// ---------------------------------------------------------------------------

export const EVENT_MARKERS_SOURCE_ID = "bumelerze-events";
export const EVENT_MARKERS_GLOW_LAYER_ID = "bumelerze-events-glow";
export const EVENT_MARKERS_SHADOW_LAYER_ID = "bumelerze-events-shadow";
export const EVENT_MARKERS_HALO_LAYER_ID = "bumelerze-events-halo";
export const EVENT_MARKERS_CORE_LAYER_ID = "bumelerze-events-core";

/** What one marker feature carries; colours are resolved by the layers'
 * paint from `tone`, so a theme switch never rebuilds the data. */
export interface EventMarkerProperties {
  id: string;
  /** Visible halo diameter, px (`magnitudeToMarkerDiameterPx`). */
  d: number;
  /** Opaque core diameter, px. */
  core: number;
  tone: MagnitudeTone;
  /** The single most recent event in the set. */
  recent: boolean;
  [key: string]: unknown;
}

export type EventMarkerFeatureCollection = FeatureCollection<
  Point,
  EventMarkerProperties
>;

/** The web marker's opaque core: 55 % of the halo, never under 6 px
 * (`map.web.tsx`'s marker-build effect computes the same inline). */
export function markerCoreDiameterPx(diameterPx: number): number {
  return Math.max(6, Math.round(diameterPx * 0.55));
}

/**
 * The web's per-event markers (`buildRegionMarkers`) as ONE GeoJSON
 * collection for one source: MapLibre Native draws every dot on the GPU
 * in a single pass, which holds up on cheap phones where hundreds of
 * native views would not. Feature order is the web's DOM order (later on
 * top), with the most recent event moved last so its ring is never hidden.
 */
export function buildEventMarkerFeatureCollection(
  markers: readonly RegionMapMarker[],
): EventMarkerFeatureCollection {
  const ordered = [
    ...markers.filter((marker) => !marker.isMostRecent),
    ...markers.filter((marker) => marker.isMostRecent),
  ];
  const features: Feature<Point, EventMarkerProperties>[] = ordered.map((marker) => ({
    type: "Feature",
    id: marker.id,
    properties: {
      id: marker.id,
      d: marker.diameterPx,
      core: markerCoreDiameterPx(marker.diameterPx),
      tone: marker.tone,
      recent: marker.isMostRecent,
    },
    geometry: { type: "Point", coordinates: [marker.lon, marker.lat] },
  }));
  return { type: "FeatureCollection", features };
}

/** Theme colours the marker layers paint with. */
export interface EventMarkerColors {
  /** `colors.magnitudeBand`: the five-band ramp the event cards use. */
  magnitudeBand: Record<MagnitudeTone, string>;
  /** `colors.action.felt`: the most recent event's ring and glow. */
  felt: string;
  /** `colors.surface.raised`: every other marker's thin ring. */
  ring: string;
}

const MAGNITUDE_TONES: readonly MagnitudeTone[] = [
  "minor",
  "light",
  "moderate",
  "strong",
  "major",
];

function toneColorExpression(colors: EventMarkerColors): unknown[] {
  const expression: unknown[] = ["match", ["get", "tone"]];
  for (const tone of MAGNITUDE_TONES) {
    expression.push(tone, colors.magnitudeBand[tone]);
  }
  expression.push(colors.magnitudeBand.minor);
  return expression;
}

/** Halo ring widths, px: the web's 2.5 px felt-red border on the most
 * recent marker and 1.5 px surface-coloured border on the others. */
const RECENT_RING_PX = 2.5;
const RING_PX = 1.5;
/** The web's `0 0 0 4px` glow around the most recent marker. */
const RECENT_GLOW_PX = 4;

/**
 * The marker layers, bottom to top, matching the web's DOM marker:
 * a soft drop shadow (the web's `box-shadow`) or, for the most recent
 * event, the felt-red glow; the translucent halo (32 % of the tone colour,
 * with its ring); and the opaque core.
 */
export function buildEventMarkerLayers(colors: EventMarkerColors): NativeLayerProps[] {
  const tone = toneColorExpression(colors);
  const haloRadius = ["/", ["get", "d"], 2];
  const isRecent = ["==", ["get", "recent"], true];
  const ringWidth = ["case", isRecent, RECENT_RING_PX, RING_PX];
  return [
    {
      id: EVENT_MARKERS_SHADOW_LAYER_ID,
      type: "circle",
      source: EVENT_MARKERS_SOURCE_ID,
      filter: ["!", isRecent],
      paint: {
        "circle-radius": ["+", haloRadius, RING_PX + 1],
        "circle-color": "#000000",
        "circle-opacity": 0.22,
        "circle-blur": 0.6,
        "circle-translate": [0, 1],
      },
    },
    {
      id: EVENT_MARKERS_GLOW_LAYER_ID,
      type: "circle",
      source: EVENT_MARKERS_SOURCE_ID,
      filter: isRecent,
      paint: {
        "circle-radius": ["+", haloRadius, RECENT_RING_PX + RECENT_GLOW_PX],
        "circle-color": colors.felt,
        "circle-opacity": 0.22,
      },
    },
    {
      id: EVENT_MARKERS_HALO_LAYER_ID,
      type: "circle",
      source: EVENT_MARKERS_SOURCE_ID,
      paint: {
        "circle-radius": haloRadius,
        "circle-color": tone,
        "circle-opacity": 0.32,
        "circle-stroke-width": ringWidth,
        "circle-stroke-color": ["case", isRecent, colors.felt, colors.ring],
        "circle-stroke-opacity": 1,
      },
    },
    {
      id: EVENT_MARKERS_CORE_LAYER_ID,
      type: "circle",
      source: EVENT_MARKERS_SOURCE_ID,
      paint: {
        "circle-radius": ["/", ["get", "core"], 2],
        "circle-color": tone,
        "circle-opacity": 1,
      },
    },
  ];
}

/** Half the touch box around a press on the marker source, pt: 44 pt in
 * all, Apple's minimum target and about the web's largest marker hit area
 * (34 px dot + 10 px padding each side). */
export const EVENT_MARKER_HITBOX_HALF_PT = 22;

interface PressedFeatureLike {
  geometry?: { type?: string; coordinates?: unknown } | null;
  properties?: Record<string, unknown> | null;
}

/**
 * Which event a press on the marker source meant: of the features MapLibre
 * found inside the touch box, the one whose centre is nearest the finger
 * (overlapping markers at low zoom are expected, the owner's call), or
 * `null` when none carries an event id.
 */
export function pickPressedEventId(
  features: readonly PressedFeatureLike[],
  press: readonly [number, number],
): string | null {
  const [pressLon, pressLat] = press;
  const cosLat = Math.cos((pressLat * Math.PI) / 180);
  let best: { id: string; distance: number } | null = null;
  for (const feature of features) {
    const id = feature.properties?.id;
    const coordinates = feature.geometry?.coordinates;
    if (typeof id !== "string" || !Array.isArray(coordinates)) continue;
    const [lon, lat] = coordinates as number[];
    if (typeof lon !== "number" || typeof lat !== "number") continue;
    const dx = (lon - pressLon) * cosLat;
    const dy = lat - pressLat;
    const distance = dx * dx + dy * dy;
    if (!best || distance < best.distance) best = { id, distance };
  }
  return best?.id ?? null;
}
