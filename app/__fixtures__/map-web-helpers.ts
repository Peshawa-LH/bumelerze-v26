/**
 * Shared maplibre-gl mock + fixtures for the Map (web) screen test files
 * (`map-web-*.test.tsx`).
 */
import { act } from "@testing-library/react-native";

import type { Event } from "@/features/events";

export const mockPush = jest.fn();

export const mockUseRegionEvents = jest.fn();
export const mockUseWorldEvents = jest.fn();

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

/** Overrides the style `getStyle()` reports AFTER a `setStyle(...)` call
 * (the basemap-style-picker swap, `map-web-style-picker.test.tsx`) —
 * independent of `setMockMapStyleFixture` above (which only affects the
 * INITIAL style a freshly-constructed `MockMap` starts with). `null`
 * (the default, restored by `resetMapWebMocks`) makes `setStyle` fall back
 * to the same representative default layers/sources every `new MockMap(...)`
 * starts with, so a swap-then-inspect test sees a believably "different but
 * still plausible" style without needing to specify one explicitly. */
let nextMockSetStyleLayers: MockStyleLayer[] | null = null;
let nextMockSetStyleSources: Record<string, { type: string }> | null = null;
export function setMockSetStyleFixture(
  fixture: { layers?: MockStyleLayer[]; sources?: Record<string, { type: string }> } | null,
) {
  nextMockSetStyleLayers = fixture?.layers ?? null;
  nextMockSetStyleSources = fixture?.sources ?? null;
}

export const mockMapFitBounds = jest.fn();
export const mockMapSetStyle = jest.fn();
export const mockMapOnce = jest.fn();
/** The event-preview sheet's subtle recenter-on-select (`map.easeTo`,
 * `map.web.tsx`'s marker `activate` handler) — recorded the same way every
 * other camera call in this fixture is, so a test can assert on the
 * `center`/`offset`/`duration` a marker selection actually requested. */
export const mockMapEaseTo = jest.fn();

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

/** A layer-scoped `.on(event, layerId, handler)` event, matching the one
 * shape `map.web.tsx` actually reads off it (`event.features[0].properties`
 * — the cluster-click-to-zoom handler). */
export interface MockLayerEvent {
  features?: { properties: Record<string, unknown> }[];
}

/** Every `MockMap` constructed this test run, in construction order — lets
 * a test reach the live instance directly (`.setZoom`/`.fireZoomEnd`/
 * `.fireLayerEvent`) for clustering/zoom scenarios that a jest.fn() spy
 * alone can't drive (there's no DOM node a real zoom gesture or a GL
 * layer's hit-tested click could be dispatched against under jsdom).
 * Cleared by `resetMapWebMocks`. */
export const mockMapInstances: MockMap[] = [];

/**
 * Default zoom every fresh `MockMap` reports via `getZoom()` unless a test
 * overrides it (`setMockNextMapZoom`) — deliberately WELL ABOVE
 * `CLUSTER_MAX_ZOOM` (`clustering.ts`, 8) so every PRE-EXISTING test in this
 * suite (marker counts, filter/scope/style-picker behavior — none of which
 * are about clustering) keeps building exactly one DOM marker per event, as
 * it always has: clustering only ever activates in a test that explicitly
 * asks for it via `setMockNextMapZoom`/`map.setZoom`.
 */
export const DEFAULT_MOCK_MAP_ZOOM = 12;
let mockNextMapZoom: number | undefined;
export function setMockNextMapZoom(zoom: number | undefined) {
  mockNextMapZoom = zoom;
}

export class MockMap {
  options: Record<string, unknown>;
  handlers: Record<string, () => void> = {};
  private onceHandlers: Record<string, (() => void)[]> = {};
  private layerHandlers: Record<string, Record<string, (event: MockLayerEvent) => void>> =
    {};
  /** See `DEFAULT_MOCK_MAP_ZOOM`'s doc comment. Mutable (`setZoom`) so a
   * test can simulate the user zooming in/out, then `fireZoomEnd()` to
   * mirror `map.web.tsx`'s own `"zoomend"` -> `setZoom(map.getZoom())`
   * wiring. */
  zoom: number = mockNextMapZoom ?? DEFAULT_MOCK_MAP_ZOOM;
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
    mockMapInstances.push(this);
  }

  /**
   * Two real MapLibre overloads: `.on(event, handler)` (map-wide, e.g.
   * "load"/"error"/"zoomend") and `.on(event, layerId, handler)`
   * (layer-scoped, e.g. the cluster circle layer's "click") — distinguished
   * here the same way the real library's overload resolution works, by
   * whether the second argument is a function or a layer-id string.
   */
  on(event: string, handlerOrLayerId: (() => void) | string, maybeHandler?: (event: MockLayerEvent) => void) {
    if (typeof handlerOrLayerId === "string") {
      const layerId = handlerOrLayerId;
      const handler = maybeHandler as (event: MockLayerEvent) => void;
      this.layerHandlers[event] ??= {};
      this.layerHandlers[event][layerId] = handler;
      return;
    }
    const handler = handlerOrLayerId;
    this.handlers[event] = handler;
    if (event === "load" && !this.shouldError) {
      void Promise.resolve().then(() => act(() => handler()));
    }
    if (event === "error" && this.shouldError) {
      void Promise.resolve().then(() => act(() => handler()));
    }
  }

  /** Test helper: simulates the user's zoom settling at a new level —
   * updates `getZoom()`'s return value AND fires any registered "zoomend"
   * handler, mirroring `map.web.tsx`'s own `map.on("zoomend", () =>
   * setZoom(map.getZoom()))` wiring in one call. Callers still need to wrap
   * this in RNTL's `act()` themselves (matching every other handler-firing
   * helper in this file), since it synchronously drives a React state
   * update in the component under test. */
  setZoomAndFireZoomEnd(zoom: number) {
    this.zoom = zoom;
    this.handlers.zoomend?.();
  }

  getZoom() {
    return this.zoom;
  }

  /** Test helper: simulates a layer-scoped hit (e.g. a cluster badge
   * click) — invokes whatever handler `map.web.tsx` registered via
   * `.on(event, layerId, handler)` for `layerId`, with a single feature
   * carrying `properties`. */
  fireLayerEvent(event: string, layerId: string, properties: Record<string, unknown>) {
    this.layerHandlers[event]?.[layerId]?.({ features: [{ properties }] });
  }

  addControl(control: unknown) {
    mockMapAddControl(control);
  }

  remove() {
    mockMapRemove();
  }

  /** `map.once("style.load", handler)` — the ONLY `once` usage `map.web.tsx`
   * makes (`handleStyleChange`'s post-`setStyle` terrain/label
   * re-application). Fires exactly once, asynchronously, mirroring `on`'s
   * "load"/"error" auto-fire above — matches how a real MapLibre map's
   * `setStyle()` resolves asynchronously once the new style document has
   * loaded. */
  once(event: string, handler: () => void) {
    mockMapOnce(event);
    this.onceHandlers[event] = [...(this.onceHandlers[event] ?? []), handler];
  }

  fitBounds(bounds: unknown, options?: unknown) {
    mockMapFitBounds(bounds, options);
  }

  easeTo(options: unknown) {
    mockMapEaseTo(options);
  }

  /** Simulates MapLibre's real `setStyle()` behavior: replaces the ENTIRE
   * style document (wiping every source/layer WE added — terrain
   * hillshade, own-labels, locale-relabeled basemap layers), then fires any
   * pending `"style.load"` `once` handlers once the "new style" is in
   * place — exactly what `handleStyleChange` (`map.web.tsx`) relies on to
   * re-run `primeTerrainAndLabelCache`/`applyLocaleLabels` against the
   * post-swap style. */
  setStyle(url: string) {
    mockMapSetStyle(url);
    this.options = { ...this.options, style: url };
    this.styleLayers = structuredClone(nextMockSetStyleLayers ?? defaultMockStyleLayers());
    this.styleSources = structuredClone(
      nextMockSetStyleSources ?? defaultMockStyleSources(),
    );
    this.geoJsonSources = {};
    const pending = this.onceHandlers["style.load"] ?? [];
    this.onceHandlers["style.load"] = [];
    void Promise.resolve().then(() => act(() => pending.forEach((handler) => handler())));
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

/**
 * A fixed, deterministic stand-in for `dataUpdatedAt` (React Query's own
 * last-successful-fetch timestamp) — `map.web.tsx`'s date-filter bounds key
 * off this field directly, not a bare `Date.now()` read (see that file's
 * own doc comment for why: a render-time value there used to defeat
 * memoization and rebuild every marker on every unrelated re-render). Any
 * test mocking a non-empty event list should pass this as `dataUpdatedAt`
 * alongside `events` — set safely after `makeEvent`'s own default
 * `originTime` so a default-shaped event's timestamp always falls inside
 * the resulting bounds.
 */
export const MOCK_DATA_UPDATED_AT = Date.UTC(2026, 7, 17, 12, 0, 0);

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
  // `dataUpdatedAt` matches the real `useEventsFeed`'s shape (React Query's
  // own last-fetch timestamp, defaulting to `0` before any fetch ever
  // succeeds) — `map.web.tsx`'s date-filter bounds (`dateBounds`) key off
  // this field directly (see that file's own doc comment for why), so a
  // mock that omitted it entirely used to silently produce `NaN` bounds and
  // zero rendered markers whenever a test supplied non-empty events.
  mockUseRegionEvents.mockReturnValue({ events: [], dataUpdatedAt: 0 });
  mockUseWorldEvents.mockReturnValue({ events: [], dataUpdatedAt: 0 });
  mockMapAddSource.mockClear();
  mockMapAddLayer.mockClear();
  mockMapSetLayoutProperty.mockClear();
  mockMapGetLayoutProperty.mockClear();
  mockMapGetSource.mockClear();
  mockSourceSetData.mockClear();
  mockMapFitBounds.mockClear();
  mockMapEaseTo.mockClear();
  mockMapSetStyle.mockClear();
  mockMapOnce.mockClear();
  setMockMapStyleFixture({});
  setMockSetStyleFixture(null);
  resetMockRTLTextPlugin();
  mockMapInstances.length = 0;
  mockNextMapZoom = undefined;
}
