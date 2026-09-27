import type {
  GeoJSONSourceSpecification,
  LineLayerSpecification,
  Map as MapLibreMap,
} from "maplibre-gl";

import { MAP_ASSET_REVISION } from "./config";
import { findFirstSymbolLayerId } from "./terrain";

/**
 * The map layer registry (decisions.md D28, research/data-architecture-v2.md
 * §2): every dataset the map can draw, as data — what it is, where it comes
 * from, what credit it requires, whether it is on by default. The Layers
 * panel is generated from this list and the map adds/removes overlays from
 * it, so a new dataset is a new row here plus its renderer, never a new
 * panel or a new preference.
 */
export type MapLayerId = "events" | "faults-gem";

export interface MapLayerEntry {
  id: MapLayerId;
  /** i18n key of the label shown in the Layers panel. */
  titleKey: string;
  /** i18n key of the one-line credit shown under the toggle. */
  attributionKey: string;
  source: string;
  sourceUrl: string;
  license: string;
  availabilityStatus: "available" | "licensed-pending" | "planned";
  rendererType: "markers" | "geojson";
  /** design-language.md §6: only earthquakes are on by default. */
  defaultOn: boolean;
  /** `false` for layers the map cannot do without (the events themselves). */
  toggleable: boolean;
}

export const MAP_LAYERS: readonly MapLayerEntry[] = [
  {
    id: "events",
    titleKey: "map.layers.events",
    attributionKey: "map.layers.eventsAttribution",
    source: "USGS, EMSC, GEOFON",
    sourceUrl: "https://bumelerze.com/handbook.html",
    license: "public feeds, attributed",
    availabilityStatus: "available",
    rendererType: "markers",
    defaultOn: true,
    toggleable: false,
  },
  {
    // GEM Global Active Faults (Styron & Pagani 2020), CC BY-SA 4.0 —
    // redistributable, unlike the AFEAD set the project also holds (free
    // for research only; owner, 2026-09-28: GEM is the default).
    id: "faults-gem",
    titleKey: "map.layers.faults",
    attributionKey: "map.layers.faultsAttribution",
    source: "GEM Foundation — Global Active Faults Database",
    sourceUrl: "https://github.com/GEMScienceTools/gem-global-active-faults",
    license: "CC BY-SA 4.0",
    availabilityStatus: "available",
    rendererType: "geojson",
    defaultOn: false,
    toggleable: true,
  },
];

export const TOGGLEABLE_MAP_LAYERS: readonly MapLayerEntry[] = MAP_LAYERS.filter(
  (layer) => layer.toggleable,
);

/** Persisted shape: only toggleable layers, `true` = shown. */
export type MapOverlayState = Partial<Record<MapLayerId, boolean>>;

export function isOverlayOn(overlays: MapOverlayState, id: MapLayerId): boolean {
  const entry = MAP_LAYERS.find((layer) => layer.id === id);
  return overlays[id] ?? entry?.defaultOn ?? false;
}

/** The regional clip of the GEM database shipped with the web build
 * (`public/data/`, 386 faults, lat 25–43 / lon 34–54), stamped like the
 * other map assets so a refreshed file reaches cached browsers. */
export const FAULTS_GEOJSON_URL = `${process.env.EXPO_BASE_URL ?? ""}/data/gem-active-faults-region.geojson?v=${MAP_ASSET_REVISION}`;

export const FAULTS_SOURCE_ID = "bumelerze-faults";
export const FAULTS_LAYER_ID = "bumelerze-faults-lines";

export function buildFaultsSource(
  url: string = FAULTS_GEOJSON_URL,
): GeoJSONSourceSpecification {
  return { type: "geojson", data: url };
}

/**
 * Fault traces coloured by slip type — the one attribute a lay reader can
 * be told in a sentence (reverse: the Zagros front; strike-slip: the East
 * Anatolian / Main Recent faults). Drawn beneath every label layer.
 */
export function buildFaultsLayer(scheme: "light" | "dark"): LineLayerSpecification {
  return {
    id: FAULTS_LAYER_ID,
    type: "line",
    source: FAULTS_SOURCE_ID,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": [
        "match",
        ["get", "slip_type"],
        "Reverse",
        "#C3202B",
        "Normal",
        "#2E6E9E",
        [
          "Dextral",
          "Sinistral",
          "Dextral-Reverse",
          "Sinistral-Reverse",
          "Dextral-Normal",
          "Sinistral-Normal",
        ],
        "#D2691E",
        "#A8880A",
      ],
      "line-width": ["interpolate", ["linear"], ["zoom"], 4, 0.7, 8, 1.5, 12, 2.4],
      "line-opacity": scheme === "dark" ? 0.85 : 0.9,
    },
  };
}

/**
 * Idempotently adds or removes the fault overlay on a live map, keeping it
 * under the basemap's first symbol layer so place names stay legible.
 * Safe to call before a style has loaded (does nothing) and after a style
 * swap (re-adds from scratch, since `setStyle` wipes our layers).
 */
export function applyFaultsOverlay(
  map: MapLibreMap,
  on: boolean,
  scheme: "light" | "dark",
): void {
  const style = map.getStyle();
  if (!style) return;
  const hasLayer = map.getLayer(FAULTS_LAYER_ID) !== undefined;
  if (!on) {
    if (hasLayer) map.removeLayer(FAULTS_LAYER_ID);
    if (map.getSource(FAULTS_SOURCE_ID)) map.removeSource(FAULTS_SOURCE_ID);
    return;
  }
  if (hasLayer) return;
  if (!map.getSource(FAULTS_SOURCE_ID))
    map.addSource(FAULTS_SOURCE_ID, buildFaultsSource());
  map.addLayer(buildFaultsLayer(scheme), findFirstSymbolLayerId(style.layers ?? []));
}
