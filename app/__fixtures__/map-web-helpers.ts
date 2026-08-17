/**
 * Shared maplibre-gl mock + fixtures for the Map (web) screen test files
 * (`map-web-*.test.tsx`).
 */
import { act } from "@testing-library/react-native";

import type { Event } from "@/features/events";

export const mockPush = jest.fn();

export const mockUseRegionEvents = jest.fn();

/** `on("load"/"error", handler)` auto-fires the registered handler on the
 * next microtask — mirroring a real map's async style-load completion.
 * Controlled by `mockNextMapShouldError` (module scope, reset by each
 * file's own `beforeEach`) so error-path tests can flip a flag instead of
 * reaching into the map instance and firing events by hand. Applies to
 * EVERY map instance when `mockMapErrorQueue` (below) is empty. */
let mockNextMapShouldError = false;
export function setMockNextMapShouldError(value: boolean) {
  mockNextMapShouldError = value;
  mockMapErrorQueue = [];
}

/** Per-instance override queue, consumed one entry per `new MockMap(...)`
 * call (in construction order) — falls back to `mockNextMapShouldError` for
 * any instance once the queue is empty. Exists for the runtime-fallback
 * tests: e.g. `setMockMapErrorQueue([true, false])` makes the FIRST map
 * instance fail (simulating a bad MapTiler key/quota) and the SECOND one
 * (the automatic one-shot OpenFreeMap fallback recreates the map
 * synchronously, inside the first instance's own "error" handler — there's
 * no pause point a test could use to flip a single shared flag between the
 * two) succeed, deterministically. */
let mockMapErrorQueue: boolean[] = [];
export function setMockMapErrorQueue(queue: boolean[]) {
  mockMapErrorQueue = [...queue];
}

export const mockMapAddControl = jest.fn();
export const mockMapRemove = jest.fn();
export const mockMarkerSetLngLat = jest.fn();
export const mockMarkerAddTo = jest.fn();
export const mockMarkerRemove = jest.fn();
export const mockMapConstructorOptions: Record<string, unknown>[] = [];
export const mockMarkerConstructorOptions: { element: HTMLElement }[] = [];

/** Terrain/label wiring mocks — record every call so tests can assert on
 * what `primeTerrainAndLabelCache`/`applyLocaleLabels` (map.web.tsx) did,
 * without needing a real MapLibre style/renderer. */
export const mockMapAddSource = jest.fn();
export const mockMapAddLayer = jest.fn();
export const mockMapSetLayoutProperty = jest.fn();
export const mockMapGetLayoutProperty = jest.fn();
export const mockMapGetSource = jest.fn();
/** `(sourceId, data)` — every `GeoJSONSource.setData(...)` call recorded
 * across every geojson source any mock `Map` instance was given, own-labels
 * locale refresh (`map.web.tsx`) being the only caller today. */
export const mockSourceSetData = jest.fn();

export interface MockStyleLayer {
  id: string;
  type: string;
  layout?: Record<string, unknown>;
}

/** A small but representative style: a fill (land), a line (roads), and a
 * name-labeling symbol layer — enough to exercise the hillshade insertion
 * position (before the first line/symbol layer) and label-localization
 * (the one name-labeling symbol layer) logic meaningfully. No `raster-dem`
 * source by default, so terrain insertion is exercised by default too;
 * `setMockMapStyleFixture` lets individual tests override either. */
function defaultMockStyleLayers(): MockStyleLayer[] {
  return [
    { id: "background", type: "background" },
    { id: "land", type: "fill" },
    { id: "roads", type: "line" },
    { id: "place-labels", type: "symbol", layout: { "text-field": ["get", "name"] } },
  ];
}
function defaultMockStyleSources(): Record<string, { type: string }> {
  return { openmaptiles: { type: "vector" } };
}

let nextMockStyleLayers = defaultMockStyleLayers();
let nextMockStyleSources = defaultMockStyleSources();

/** Overrides the style `getStyle()` will report for the NEXT map instance
 * created — reset to the representative default (above) by
 * `resetMapWebMocks`. `structuredClone` so each test's mutations (via
 * `setLayoutProperty`/`addSource`/`addLayer` below) never leak into another
 * test's fixture object. */
export function setMockMapStyleFixture(fixture: {
  layers?: MockStyleLayer[];
  sources?: Record<string, { type: string }>;
}) {
  nextMockStyleLayers = fixture.layers ?? defaultMockStyleLayers();
  nextMockStyleSources = fixture.sources ?? defaultMockStyleSources();
}

/** Records the order `setWorkerUrl(...)` and `new Map(...)` are called in,
 * across all mocks below — locks map.web.tsx's requirement that the worker
 * URL is assigned before the map (and therefore its worker pool) is
 * constructed. See MAP_WORKER_URL's doc comment (config.ts) for why this
 * ordering matters. */
export const mockWorkerUrlCallOrder: string[] = [];
export const mockSetWorkerUrl = jest.fn((url: string) => {
  mockWorkerUrlCallOrder.push(`setWorkerUrl:${url}`);
});

/**
 * RTL text plugin mocks — mimic the REAL `maplibre-gl` singleton's behavior
 * (module-scope state, `"unavailable"` initially, throws on a second
 * `setRTLTextPlugin` call) closely enough that `map.web.tsx`'s
 * `shouldRequestRTLTextPlugin` idempotency guard is actually exercised
 * rather than trivially passing against an always-compliant mock. Reset by
 * `resetMapWebMocks` each test (module-scope `rtlPluginRequestedUrl` reset
 * to `null`/status back to `"unavailable"`), matching the "fresh page load"
 * state assumption every test starts from.
 */
let rtlPluginRequestedUrl: string | null = null;
let rtlPluginStatus = "unavailable";
export const mockGetRTLTextPluginStatus = jest.fn(() => rtlPluginStatus);
/** Lets a test simulate "the RTL plugin was already requested earlier this
 * page session" (e.g. by a previous Map-tab mount) WITHOUT actually
 * rendering and tearing down a real map instance first — the idempotency
 * guard (`shouldRequestRTLTextPlugin`) only cares about the reported
 * status, so this is a much more direct way to exercise it than a real
 * double-mount, which is prone to unrelated cross-test async/act
 * interleaving in this suite's promise-driven `MockMap`. */
export function setMockRTLTextPluginStatus(status: string) {
  rtlPluginRequestedUrl = status === "unavailable" ? null : "already-requested";
  rtlPluginStatus = status;
}
export const mockSetRTLTextPlugin = jest.fn((url: string, lazy?: boolean) => {
  if (rtlPluginRequestedUrl) {
    return Promise.reject(new Error("setRTLTextPlugin cannot be called multiple times."));
  }
  rtlPluginRequestedUrl = url;
  rtlPluginStatus = lazy ? "deferred" : "loaded";
  mockWorkerUrlCallOrder.push(`setRTLTextPlugin:${url}`);
  return Promise.resolve();
});
function resetMockRTLTextPlugin() {
  rtlPluginRequestedUrl = null;
  rtlPluginStatus = "unavailable";
  mockGetRTLTextPluginStatus.mockClear();
  mockSetRTLTextPlugin.mockClear();
}

export class MockMap {
  options: Record<string, unknown>;
  handlers: Record<string, () => void> = {};
  // Per-instance, independently mutable copies of the module-scope fixture
  // — `structuredClone` so no two map instances (e.g. the original +ONE
  // recreated by a retry/fallback within the same test) ever share layer
  // objects.
  private styleLayers: MockStyleLayer[] = structuredClone(nextMockStyleLayers);
  private styleSources: Record<string, { type: string }> =
    structuredClone(nextMockStyleSources);
  // Captured once at construction (not read live from the module-scope
  // flag/queue on every `on()` call) — see `mockMapErrorQueue`'s doc
  // comment for why this needs to be resolved per instance.
  private shouldError: boolean =
    mockMapErrorQueue.length > 0
      ? (mockMapErrorQueue.shift() as boolean)
      : mockNextMapShouldError;

  constructor(options: Record<string, unknown>) {
    this.options = options;
    mockMapConstructorOptions.push(options);
    mockWorkerUrlCallOrder.push("mapConstructed");
  }

  on(event: string, handler: () => void) {
    this.handlers[event] = handler;
    if (event === "load" && !this.shouldError) {
      void Promise.resolve().then(() => act(() => handler()));
    }
    if (event === "error" && this.shouldError) {
      void Promise.resolve().then(() => act(() => handler()));
    }
  }

  addControl(control: unknown) {
    mockMapAddControl(control);
  }

  remove() {
    mockMapRemove();
  }

  getStyle() {
    return { layers: this.styleLayers, sources: this.styleSources };
  }

  // geojson sources only — enough to back `getSource(id).setData(...)`,
  // which is all `map.web.tsx`'s own-labels locale-refresh path calls.
  private geoJsonSources: Record<string, { setData: (data: unknown) => void }> = {};

  addSource(id: string, source: { type: string; data?: unknown }) {
    mockMapAddSource(id, source);
    this.styleSources[id] = source;
    if (source.type === "geojson") {
      this.geoJsonSources[id] = {
        setData: (data: unknown) => mockSourceSetData(id, data),
      };
    }
  }

  getSource(id: string) {
    mockMapGetSource(id);
    return this.geoJsonSources[id];
  }

  addLayer(layer: MockStyleLayer, beforeId?: string) {
    mockMapAddLayer(layer, beforeId);
    const insertAt = beforeId ? this.styleLayers.findIndex((l) => l.id === beforeId) : -1;
    if (insertAt === -1) {
      this.styleLayers.push(layer);
    } else {
      this.styleLayers.splice(insertAt, 0, layer);
    }
  }

  getLayoutProperty(layerId: string, name: string) {
    mockMapGetLayoutProperty(layerId, name);
    return this.styleLayers.find((layer) => layer.id === layerId)?.layout?.[name];
  }

  setLayoutProperty(layerId: string, name: string, value: unknown) {
    mockMapSetLayoutProperty(layerId, name, value);
    const layer = this.styleLayers.find((candidate) => candidate.id === layerId);
    if (layer) {
      layer.layout = { ...(layer.layout ?? {}), [name]: value };
    }
  }
}

export class MockMarker {
  element: HTMLElement;

  constructor(options: { element: HTMLElement }) {
    this.element = options.element;
    mockMarkerConstructorOptions.push(options);
  }

  setLngLat(lngLat: [number, number]) {
    mockMarkerSetLngLat(lngLat);
    return this;
  }

  addTo(map: MockMap) {
    mockMarkerAddTo(map);
    return this;
  }

  remove() {
    mockMarkerRemove();
  }
}

export class MockAttributionControl {
  options: Record<string, unknown>;
  constructor(options: Record<string, unknown>) {
    this.options = options;
  }
}

export const testSafeAreaMetrics = {
  frame: { x: 0, y: 0, width: 360, height: 640 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

export function makeEvent(overrides: Partial<Event> = {}): Event {
  return {
    id: "us7000abcd",
    originTime: Date.UTC(2026, 7, 15, 12, 0, 0),
    lat: 35.56,
    lon: 45.43,
    depthKm: 10,
    magnitude: { value: 4.5, type: "mb" },
    placeName: "32 km SE of Halabja, Iraq",
    provenance: {
      provider: "usgs",
      providerId: "us7000abcd",
      fetchedAt: Date.now(),
      providerUpdatedAt: Date.now(),
    },
    sig: 300,
    isRegional: true,
    url: "https://earthquake.usgs.gov/earthquakes/eventpage/us7000abcd",
    ...overrides,
  };
}

export function resetMapWebMocks() {
  mockNextMapShouldError = false;
  mockMapErrorQueue = [];
  mockPush.mockClear();
  mockMapAddControl.mockClear();
  mockMapRemove.mockClear();
  mockMarkerSetLngLat.mockClear();
  mockMarkerAddTo.mockClear();
  mockMarkerRemove.mockClear();
  mockMapConstructorOptions.length = 0;
  mockMarkerConstructorOptions.length = 0;
  mockSetWorkerUrl.mockClear();
  mockWorkerUrlCallOrder.length = 0;
  mockUseRegionEvents.mockReturnValue({ events: [] });
  mockMapAddSource.mockClear();
  mockMapAddLayer.mockClear();
  mockMapSetLayoutProperty.mockClear();
  mockMapGetLayoutProperty.mockClear();
  mockMapGetSource.mockClear();
  mockSourceSetData.mockClear();
  setMockMapStyleFixture({});
  resetMockRTLTextPlugin();
}
