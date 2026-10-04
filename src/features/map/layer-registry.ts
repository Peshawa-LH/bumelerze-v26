import type {
  CircleLayerSpecification,
  ExpressionSpecification,
  GeoJSONSourceSpecification,
  ImageSourceSpecification,
  LayerSpecification,
  LineLayerSpecification,
  Map as MapLibreMap,
  RasterLayerSpecification,
} from "maplibre-gl";

import { MAP_ASSET_REVISION } from "./config";
import { findFirstSymbolLayerId } from "./terrain";
import { VS30_OVERLAY_BOUNDS } from "./vs30-overlay";

/**
 * The map layer registry (decisions.md D28, research/data-architecture-v2.md
 * §2): every dataset the map can draw, as data — what it is, where it comes
 * from, what credit it requires, whether it is on by default. The Layers
 * panel is generated from this list and the map adds/removes overlays from
 * it, so a new dataset is a new row here plus its renderer, never a new
 * panel or a new preference.
 */
export type MapLayerId =
  "events" | "faults-afead" | "faults-gem" | "historical-quakes" | "site-vs30";

export type OverlayLayerId = Exclude<MapLayerId, "events">;

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
  rendererType: "markers" | "geojson" | "raster";
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
    // AFEAD v2021 (Zelenin et al. 2022, ESSD 14, 4489; GIN RAS), CC BY 4.0:
    // redistributable with credit. The detailed regional set — names,
    // zones, activity confidence and references per fault.
    id: "faults-afead",
    titleKey: "map.layers.faultsAfead",
    attributionKey: "map.layers.faultsAfeadAttribution",
    source: "Active Faults of Eurasia Database (AFEAD v2021), GIN RAS",
    sourceUrl: "https://essd.copernicus.org/articles/14/4489/2022/",
    license: "CC BY 4.0",
    availabilityStatus: "available",
    rendererType: "geojson",
    defaultOn: false,
    toggleable: true,
  },
  {
    // GEM Global Active Faults (Styron & Pagani 2020), CC BY-SA 4.0. In
    // this region it carries the EMME fault model with slip rates.
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
  {
    // The app's own bundled catalogue, M >= 5 (homogenised Mw where one
    // exists), exported by bumelerze-engine scripts/export_map_overlays.py.
    id: "historical-quakes",
    titleKey: "map.layers.historical",
    attributionKey: "map.layers.historicalAttribution",
    source: "Bumelerze catalogue (EMME, ISC-GEM, ISC, USGS, EMSC and others)",
    sourceUrl: "https://bumelerze.com/handbook.html",
    license: "per source catalogue, attributed",
    availabilityStatus: "available",
    rendererType: "geojson",
    defaultOn: false,
    toggleable: true,
  },
  {
    // USGS global Vs30 model (topographic-slope proxy; public domain), the
    // same backbone the SHAKEmap engine samples, classed by NEHRP site class.
    id: "site-vs30",
    titleKey: "map.layers.siteVs30",
    attributionKey: "map.layers.siteVs30Attribution",
    source: "USGS global Vs30 model",
    sourceUrl: "https://earthquake.usgs.gov/data/vs30/",
    license: "public domain (USGS)",
    availabilityStatus: "available",
    rendererType: "raster",
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

export function activeOverlayIds(overlays: MapOverlayState): OverlayLayerId[] {
  return TOGGLEABLE_MAP_LAYERS.filter((layer) => isOverlayOn(overlays, layer.id)).map(
    (layer) => layer.id as OverlayLayerId,
  );
}

const base = process.env.EXPO_BASE_URL ?? "";
const stamp = (path: string) => `${base}/data/${path}?v=${MAP_ASSET_REVISION}`;

/** Regional clips shipped with the web build (`public/data/`), stamped like
 * the other map assets so a refreshed file reaches cached browsers. */
export const FAULTS_GEOJSON_URL = stamp("gem-active-faults-region.geojson");
export const AFEAD_GEOJSON_URL = stamp("afead-faults-region.geojson");
export const HISTORICAL_GEOJSON_URL = stamp("historical-earthquakes.geojson");
export const VS30_IMAGE_URL = stamp("vs30-site-class.png");

export const FAULTS_SOURCE_ID = "bumelerze-faults";
export const FAULTS_LAYER_ID = "bumelerze-faults-lines";
export const FAULTS_HIT_LAYER_ID = "bumelerze-faults-hit";
export const AFEAD_SOURCE_ID = "bumelerze-afead";
export const AFEAD_LAYER_ID = "bumelerze-afead-lines";
export const AFEAD_HIT_LAYER_ID = "bumelerze-afead-hit";
export const HISTORICAL_SOURCE_ID = "bumelerze-historical";
export const HISTORICAL_LAYER_ID = "bumelerze-historical-circles";
export const VS30_SOURCE_ID = "bumelerze-vs30";
export const VS30_LAYER_ID = "bumelerze-vs30-raster";

/** One colour per slip family, shared by both fault sources and the legend. */
export const FAULT_COLORS = {
  reverse: "#C3202B",
  normal: "#2E6E9E",
  strikeSlip: "#D2691E",
  other: "#A8880A",
} as const;

export const HISTORICAL_ERA_COLORS = {
  light: { historical: "#B39DDB", early: "#7E57C2", modern: "#4A2C9A" },
  dark: { historical: "#D1C4E9", early: "#B39DDB", modern: "#9575CD" },
} as const;

/** NEHRP site-class colours of `public/data/vs30-site-class.png` (must match
 * SITE_CLASSES in the engine's export_map_overlays.py). */
export const SITE_CLASS_COLORS = {
  A: "#3B4A6B",
  B: "#4F7CAC",
  C: "#8FB996",
  D: "#E3C567",
  E: "#D1495B",
} as const;

export function buildFaultsSource(
  url: string = FAULTS_GEOJSON_URL,
): GeoJSONSourceSpecification {
  return { type: "geojson", data: url };
}

const lineLayout = { "line-cap": "round", "line-join": "round" } as const;
const lineWidth: ExpressionSpecification = [
  "interpolate",
  ["linear"],
  ["zoom"],
  4,
  0.7,
  8,
  1.5,
  12,
  2.4,
];

/**
 * GEM traces coloured by slip type — the one attribute a lay reader can be
 * told in a sentence (reverse: the Zagros front; strike-slip: the East
 * Anatolian / Main Recent faults). Oblique types follow their lateral part.
 */
export function buildFaultsLayer(scheme: "light" | "dark"): LineLayerSpecification {
  return {
    id: FAULTS_LAYER_ID,
    type: "line",
    source: FAULTS_SOURCE_ID,
    layout: lineLayout,
    paint: {
      "line-color": [
        "match",
        ["get", "slip_type"],
        "Reverse",
        FAULT_COLORS.reverse,
        "Normal",
        FAULT_COLORS.normal,
        [
          "Dextral",
          "Sinistral",
          "Dextral-Reverse",
          "Sinistral-Reverse",
          "Dextral-Normal",
          "Sinistral-Normal",
        ],
        FAULT_COLORS.strikeSlip,
        FAULT_COLORS.other,
      ],
      "line-width": lineWidth,
      "line-opacity": scheme === "dark" ? 0.85 : 0.9,
    },
  };
}

/**
 * AFEAD traces by primary slip sense (SENS1: R/T reverse-thrust, N/E
 * normal-extension, D/S strike-slip, V/U other), fainter as activity
 * confidence drops (CONF A proven … D once declared, evidence insufficient).
 */
export function buildAfeadLayer(scheme: "light" | "dark"): LineLayerSpecification {
  const k = scheme === "dark" ? 0.9 : 1;
  return {
    id: AFEAD_LAYER_ID,
    type: "line",
    source: AFEAD_SOURCE_ID,
    layout: lineLayout,
    paint: {
      "line-color": [
        "match",
        ["get", "s1"],
        ["R", "T"],
        FAULT_COLORS.reverse,
        ["N", "E"],
        FAULT_COLORS.normal,
        ["D", "S"],
        FAULT_COLORS.strikeSlip,
        FAULT_COLORS.other,
      ],
      "line-width": lineWidth,
      "line-opacity": [
        "match",
        ["get", "c"],
        "A",
        1 * k,
        "B",
        0.85 * k,
        "C",
        0.6 * k,
        0.4 * k,
      ],
    },
  };
}

/** An invisible wide twin of a fault layer, so a finger can hit a 1 px line. */
export function buildHitLayer(id: string, source: string): LineLayerSpecification {
  return {
    id,
    type: "line",
    source,
    layout: lineLayout,
    paint: { "line-width": 14, "line-opacity": 0, "line-color": "#000000" },
  };
}

/** Past earthquakes: size by magnitude, colour by era (how far a location
 * can be trusted: historical accounts, early instrumental, modern). */
export function buildHistoricalLayer(scheme: "light" | "dark"): CircleLayerSpecification {
  const era = HISTORICAL_ERA_COLORS[scheme];
  return {
    id: HISTORICAL_LAYER_ID,
    type: "circle",
    source: HISTORICAL_SOURCE_ID,
    layout: { "circle-sort-key": ["get", "m"] },
    paint: {
      "circle-radius": [
        "interpolate",
        ["linear"],
        ["get", "m"],
        5,
        3,
        6,
        5.5,
        7,
        9,
        8,
        13,
      ],
      "circle-color": [
        "match",
        ["get", "era"],
        "historical",
        era.historical,
        "early",
        era.early,
        era.modern,
      ],
      "circle-opacity": 0.85,
      "circle-stroke-width": 0.75,
      "circle-stroke-color": scheme === "dark" ? "#111111" : "#FFFFFF",
    },
  };
}

export function buildVs30Source(url: string = VS30_IMAGE_URL): ImageSourceSpecification {
  const { west, east, north, south } = VS30_OVERLAY_BOUNDS;
  return {
    type: "image",
    url,
    coordinates: [
      [west, north],
      [east, north],
      [east, south],
      [west, south],
    ],
  };
}

export function buildVs30Layer(scheme: "light" | "dark"): RasterLayerSpecification {
  return {
    id: VS30_LAYER_ID,
    type: "raster",
    source: VS30_SOURCE_ID,
    paint: {
      "raster-opacity": scheme === "dark" ? 0.5 : 0.55,
      "raster-resampling": "nearest",
      "raster-fade-duration": 0,
    },
  };
}

interface OverlaySpec {
  sourceId: string;
  source: () => GeoJSONSourceSpecification | ImageSourceSpecification;
  /** Bottom to top within this overlay. */
  layers: (scheme: "light" | "dark") => LayerSpecification[];
}

const OVERLAY_SPECS: Record<OverlayLayerId, OverlaySpec> = {
  "site-vs30": {
    sourceId: VS30_SOURCE_ID,
    source: () => buildVs30Source(),
    layers: (scheme) => [buildVs30Layer(scheme)],
  },
  "faults-gem": {
    sourceId: FAULTS_SOURCE_ID,
    source: () => buildFaultsSource(),
    layers: (scheme) => [
      buildFaultsLayer(scheme),
      buildHitLayer(FAULTS_HIT_LAYER_ID, FAULTS_SOURCE_ID),
    ],
  },
  "faults-afead": {
    sourceId: AFEAD_SOURCE_ID,
    source: () => buildFaultsSource(AFEAD_GEOJSON_URL),
    layers: (scheme) => [
      buildAfeadLayer(scheme),
      buildHitLayer(AFEAD_HIT_LAYER_ID, AFEAD_SOURCE_ID),
    ],
  },
  "historical-quakes": {
    sourceId: HISTORICAL_SOURCE_ID,
    source: () => buildFaultsSource(HISTORICAL_GEOJSON_URL),
    layers: (scheme) => [buildHistoricalLayer(scheme)],
  },
};

/** Paint order of the overlays, bottom to top; all of them sit under the
 * basemap's labels. The ground layer is a backdrop, faults draw over it,
 * and past earthquakes stay on top so every dot can be tapped. */
export const OVERLAY_STACK: readonly OverlayLayerId[] = [
  "site-vs30",
  "faults-gem",
  "faults-afead",
  "historical-quakes",
];

/** Layers a tap can land on, top first. */
export const OVERLAY_TAP_LAYER_IDS: readonly string[] = [
  HISTORICAL_LAYER_ID,
  AFEAD_HIT_LAYER_ID,
  FAULTS_HIT_LAYER_ID,
];

type OverlayMap = Pick<
  MapLibreMap,
  | "getStyle"
  | "getLayer"
  | "getSource"
  | "addSource"
  | "addLayer"
  | "removeLayer"
  | "removeSource"
>;

function beforeIdFor(map: OverlayMap, id: OverlayLayerId): string | undefined {
  const above = OVERLAY_STACK.slice(OVERLAY_STACK.indexOf(id) + 1);
  for (const other of above) {
    const first = OVERLAY_SPECS[other].layers("light")[0]?.id;
    if (first && map.getLayer(first) !== undefined) return first;
  }
  return findFirstSymbolLayerId(map.getStyle()?.layers ?? []);
}

/**
 * Idempotently adds or removes one overlay on a live map, keeping the
 * stack order above and every overlay under the basemap's labels. Safe to
 * call before a style has loaded (does nothing) and after a style swap
 * (re-adds from scratch, since `setStyle` wipes our layers).
 */
export function applyMapOverlay(
  map: OverlayMap,
  id: OverlayLayerId,
  on: boolean,
  scheme: "light" | "dark",
): void {
  if (!map.getStyle()) return;
  const spec = OVERLAY_SPECS[id];
  const layers = spec.layers(scheme);
  if (!on) {
    for (const layer of [...layers].reverse()) {
      if (map.getLayer(layer.id) !== undefined) map.removeLayer(layer.id);
    }
    if (map.getSource(spec.sourceId)) map.removeSource(spec.sourceId);
    return;
  }
  if (layers.every((layer) => map.getLayer(layer.id) !== undefined)) return;
  if (!map.getSource(spec.sourceId)) map.addSource(spec.sourceId, spec.source());
  const beforeId = beforeIdFor(map, id);
  for (const layer of layers) {
    if (map.getLayer(layer.id) === undefined) map.addLayer(layer, beforeId);
  }
}

/** Applies every overlay's persisted state, bottom of the stack first. */
export function applyMapOverlays(
  map: OverlayMap,
  overlays: MapOverlayState,
  scheme: "light" | "dark",
): void {
  for (const id of OVERLAY_STACK) {
    applyMapOverlay(map, id, isOverlayOn(overlays, id), scheme);
  }
}

/** Kept for callers of the first overlay. */
export function applyFaultsOverlay(
  map: OverlayMap,
  on: boolean,
  scheme: "light" | "dark",
): void {
  applyMapOverlay(map, "faults-gem", on, scheme);
}
