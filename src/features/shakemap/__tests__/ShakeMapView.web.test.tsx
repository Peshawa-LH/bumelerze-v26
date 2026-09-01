/**
 * @jest-environment jsdom
 *
 * `ShakeMapView.web.tsx` — the interactive MapLibre GL JS renderer. Same
 * mocked-`maplibre-gl`-at-the-module-boundary discipline the Map tab's own
 * `map-web-*.test.tsx` files use (`{ virtual: true }`: maplibre-gl ships
 * ESM-only, no CJS "require"/"default" export condition, so Jest's default
 * CJS resolution can't load the real package even if this file never
 * exercises it). Imported by its own explicit filename (not `../components/
 * ShakeMapView`) — this repo's default jest-expo preset has no "web"
 * platform, so a bare import would resolve the native/SVG file instead
 * (`ShakeMapView.tsx`'s own doc comment).
 */
import { act, fireEvent, render, screen } from "@testing-library/react-native";

import i18n from "@/i18n";
import damageContoursFixture from "../__fixtures__/us6000jllz/cont_damage.trimmed.json";
import halabjaContours from "../__fixtures__/us2000bmcg/cont_mi.trimmed.json";
import { parseIntensityContours } from "../contours";
import { parseDamageContours } from "../risk";
import {
  SHAKEMAP_WEB_DAMAGE_FILL_LAYER_ID,
  SHAKEMAP_WEB_INTENSITY_FILL_LAYER_ID,
} from "../web-map";

const mockMapAddControl = jest.fn();
const mockMapRemove = jest.fn();
const mockMapAddSource = jest.fn();
const mockMapAddLayer = jest.fn();
const mockMapSetLayoutProperty = jest.fn();
const mockMapFitBounds = jest.fn();
const mockMarkerSetLngLat = jest.fn();
const mockMarkerAddTo = jest.fn();
const mockMarkerRemove = jest.fn();
const mockMapConstructorOptions: Record<string, unknown>[] = [];
const mockMarkerConstructorOptions: { element: HTMLElement; anchor?: string }[] = [];
const mockNavigationControlOptions: Record<string, unknown>[] = [];
const mockAttributionControlOptions: Record<string, unknown>[] = [];

/** Controls whether the NEXT `MockMap` instance auto-fires "error" instead
 * of "load" — reset in `beforeEach`. */
let mockNextMapShouldError = false;
/** One-shot queue (construction order) — the runtime MapTiler->OpenFreeMap
 * fallback path constructs a SECOND map instance synchronously inside the
 * first one's own "error" handler, so a single shared boolean can't tell
 * the two apart; same convention `map-web-*`'s own fixture documents. */
let mockMapErrorQueue: boolean[] = [];

class MockMap {
  options: Record<string, unknown>;
  handlers: Record<string, () => void> = {};
  private shouldError: boolean =
    mockMapErrorQueue.length > 0 ? (mockMapErrorQueue.shift() as boolean) : mockNextMapShouldError;

  constructor(options: Record<string, unknown>) {
    this.options = options;
    mockMapConstructorOptions.push(options);
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
    return { layers: [], sources: {} };
  }

  addSource(id: string, source: unknown) {
    mockMapAddSource(id, source);
  }

  addLayer(layer: unknown, beforeId?: string) {
    mockMapAddLayer(layer, beforeId);
  }

  setLayoutProperty(layerId: string, name: string, value: unknown) {
    mockMapSetLayoutProperty(layerId, name, value);
  }

  fitBounds(bounds: unknown, options?: unknown) {
    mockMapFitBounds(bounds, options);
  }
}

class MockMarker {
  element: HTMLElement;
  constructor(options: { element: HTMLElement; anchor?: string }) {
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

class MockNavigationControl {
  constructor(options: Record<string, unknown>) {
    mockNavigationControlOptions.push(options);
  }
}

class MockAttributionControl {
  constructor(options: Record<string, unknown>) {
    mockAttributionControlOptions.push(options);
  }
}

// `setWorkerUrl`/`getRTLTextPluginStatus`/`setRTLTextPlugin` are hoisted
// so a single test (the "maplibre-gl import failure" one below) can make
// `loadMapLibre()`'s own `.then((maplibre) => { maplibre.setWorkerUrl(...)
// })` chain reject WITHOUT `jest.resetModules()` — resetting the module
// registry mid-file breaks the already-initialized `i18next`/React context
// singletons every OTHER test in this file (and `i18n`'s own import above)
// depends on, which is a much larger and less faithful simulation of "the
// dynamic import of maplibre-gl itself failed" than simply making the
// first call inside that `.then()` throw.
const mockSetWorkerUrl = jest.fn((_url: string) => {});
const mockGetRTLTextPluginStatus = jest.fn((): string => "unavailable");
const mockSetRTLTextPlugin = jest.fn(
  (_url: string, _lazy?: boolean): Promise<void> => Promise.resolve(),
);

jest.mock(
  "maplibre-gl",
  () => ({
    Map: MockMap,
    Marker: MockMarker,
    NavigationControl: MockNavigationControl,
    AttributionControl: MockAttributionControl,
    setWorkerUrl: (url: string) => mockSetWorkerUrl(url),
    getRTLTextPluginStatus: () => mockGetRTLTextPluginStatus(),
    setRTLTextPlugin: (url: string, lazy?: boolean) => mockSetRTLTextPlugin(url, lazy),
  }),
  { virtual: true },
);
jest.mock("maplibre-gl/dist/maplibre-gl.css", () => ({}), { virtual: true });

// Imported after the mocks above so the mocked module graph is in place —
// explicit `.web` filename, see this file's own doc comment.
// eslint-disable-next-line import/first -- see comment above
import { ShakeMapView } from "../components/ShakeMapView.web";

const HALABJA_EPICENTER = { lat: 34.9109, lon: 45.9592 };

function resetMocks() {
  mockNextMapShouldError = false;
  mockMapErrorQueue = [];
  mockMapAddControl.mockClear();
  mockMapRemove.mockClear();
  mockMapAddSource.mockClear();
  mockMapAddLayer.mockClear();
  mockMapSetLayoutProperty.mockClear();
  mockMapFitBounds.mockClear();
  mockMarkerSetLngLat.mockClear();
  mockMarkerAddTo.mockClear();
  mockMarkerRemove.mockClear();
  mockMapConstructorOptions.length = 0;
  mockMarkerConstructorOptions.length = 0;
  mockNavigationControlOptions.length = 0;
  mockAttributionControlOptions.length = 0;
}

async function renderMap(props: Partial<Parameters<typeof ShakeMapView>[0]> = {}) {
  const contours = parseIntensityContours(halabjaContours);
  const result = await render(
    <ShakeMapView
      contours={contours}
      epicenter={HALABJA_EPICENTER}
      locale="en"
      t={i18n.t}
      placeText="12 km SE of Halabja, Kurdistan Region"
      {...props}
    />,
  );
  await act(async () => {
    fireEvent(screen.getByTestId("shakemap-map-container"), "layout", {
      nativeEvent: { layout: { x: 0, y: 0, width: 600, height: 420 } },
    });
    await Promise.resolve();
    await Promise.resolve();
  });
  return result;
}

describe("ShakeMapView.web", () => {
  beforeEach(() => {
    resetMocks();
  });

  it("constructs a MapLibre map with cooperative gestures (no scroll hijack) and no built-in attribution control shown", async () => {
    await renderMap();

    expect(mockMapConstructorOptions[0]).toEqual(
      expect.objectContaining({ cooperativeGestures: true, attributionControl: false }),
    );
  });

  it("adds a compact attribution control and a top-right navigation control", async () => {
    await renderMap();

    expect(mockAttributionControlOptions[0]).toEqual(expect.objectContaining({ compact: true }));
    expect(mockMapAddControl).toHaveBeenCalledTimes(2);
  });

  it("adds one GeoJSON source with one feature per intensity contour ring", async () => {
    const contours = parseIntensityContours(halabjaContours);
    const totalRings = contours.levels.reduce((sum, level) => sum + level.rings.length, 0);
    await renderMap();

    const intensitySourceCall = mockMapAddSource.mock.calls.find(
      ([id]: [string]) => id === "bumelerze-shakemap-intensity",
    ) as [string, { data: { features: unknown[] } }] | undefined;
    expect(intensitySourceCall).toBeTruthy();
    expect(intensitySourceCall?.[1].data.features).toHaveLength(totalRings);
  });

  it("adds an intensity fill layer colored via a match expression on colors.intensity", async () => {
    await renderMap();

    const fillLayerCall = mockMapAddLayer.mock.calls.find(
      ([layer]: [{ id: string }]) => layer.id === SHAKEMAP_WEB_INTENSITY_FILL_LAYER_ID,
    );
    expect(fillLayerCall).toBeTruthy();
    const [layer] = fillLayerCall as [{ type: string; paint: { "fill-color": unknown[] } }];
    expect(layer.type).toBe("fill");
    expect(layer.paint["fill-color"][0]).toBe("match");
  });

  it("does not add a damage source/layer when no damage contours are supplied", async () => {
    await renderMap();

    const damageSourceCall = mockMapAddSource.mock.calls.find(
      ([id]: [string]) => id === "bumelerze-shakemap-damage",
    );
    expect(damageSourceCall).toBeUndefined();
  });

  it("adds a damage source (initially hidden) when a real damage product exists, and toggling shows/hides the right layers", async () => {
    const damageContours = parseDamageContours(damageContoursFixture);
    await renderMap({ damageContours });

    const damageFillCall = mockMapAddLayer.mock.calls.find(
      ([layer]: [{ id: string }]) => layer.id === SHAKEMAP_WEB_DAMAGE_FILL_LAYER_ID,
    );
    expect(damageFillCall).toBeTruthy();
    const [damageLayer] = damageFillCall as [{ layout: { visibility: string } }];
    expect(damageLayer.layout.visibility).toBe("none");

    mockMapSetLayoutProperty.mockClear();
    await act(async () => {
      fireEvent.press(screen.getByTestId("shakemap-layer-toggle-damage"));
      await Promise.resolve();
    });

    expect(mockMapSetLayoutProperty).toHaveBeenCalledWith(
      SHAKEMAP_WEB_DAMAGE_FILL_LAYER_ID,
      "visibility",
      "visible",
    );
    expect(mockMapSetLayoutProperty).toHaveBeenCalledWith(
      SHAKEMAP_WEB_INTENSITY_FILL_LAYER_ID,
      "visibility",
      "none",
    );
  });

  it("places a star marker at the event's epicenter", async () => {
    await renderMap();

    expect(mockMarkerSetLngLat).toHaveBeenCalledWith([HALABJA_EPICENTER.lon, HALABJA_EPICENTER.lat]);
    expect(mockMarkerAddTo).toHaveBeenCalledTimes(1);
    const first = mockMarkerConstructorOptions[0];
    expect(first?.element.innerHTML).toContain("<polygon");
  });

  it("fits bounds to the contour bbox on load", async () => {
    await renderMap();

    expect(mockMapFitBounds).toHaveBeenCalledTimes(1);
  });

  it("renders the shared legend strip below the map", async () => {
    await renderMap();

    expect(screen.getByText(i18n.t("eventDetail.shakemap.legendCaption"))).toBeTruthy();
  });

  it("carries the place text + max intensity into the map's accessibilityLabel", async () => {
    await renderMap();

    const container = screen.getByTestId("shakemap-map-container");
    expect(container.props.accessibilityLabel).toContain(
      "12 km SE of Halabja, Kurdistan Region",
    );
  });

  it("falls back to the SVG renderer when loading maplibre-gl itself fails (never a blank box)", async () => {
    // Simulates "the dynamic import of maplibre-gl failed" by making the
    // FIRST thing `loadMapLibre()` does inside its `.then()` throw — from
    // the component's point of view this is indistinguishable from the
    // `import()` itself rejecting (both surface as `loadMapLibre()`'s
    // returned promise rejecting), without needing `jest.resetModules()`
    // (this file's own mock-hoisting doc comment explains why that would
    // be worse).
    mockSetWorkerUrl.mockImplementationOnce(() => {
      throw new Error("chunk load failed");
    });
    const contours = parseIntensityContours(halabjaContours);

    await act(async () => {
      await render(
        <ShakeMapView
          contours={contours}
          epicenter={HALABJA_EPICENTER}
          locale="en"
          t={i18n.t}
          placeText="12 km SE of Halabja, Kurdistan Region"
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    // The now-mounted SVG renderer's own container needs its own layout
    // event before it measures itself and draws any contour polygons
    // (`ShakeMapViewSvg`'s own "renders nothing before measured" behavior,
    // exercised directly in `ShakeMapView.test.tsx`).
    await act(async () => {
      fireEvent(screen.getByTestId("shakemap-map-container"), "layout", {
        nativeEvent: { layout: { x: 0, y: 0, width: 320, height: 240 } },
      });
    });

    // The SVG renderer's own contour-ring testIDs prove the fallback
    // actually rendered, not just "didn't crash".
    expect(screen.queryAllByTestId(/^shakemap-contour-/).length).toBeGreaterThan(0);
  });

  it("falls back to the SVG renderer when the map's style fails to load and there is no further fallback", async () => {
    mockNextMapShouldError = true;

    await renderMap();
    // Same "the swapped-in SVG container needs its own layout" step as
    // the import-failure test above.
    await act(async () => {
      fireEvent(screen.getByTestId("shakemap-map-container"), "layout", {
        nativeEvent: { layout: { x: 0, y: 0, width: 320, height: 240 } },
      });
    });

    expect(screen.queryAllByTestId(/^shakemap-contour-/).length).toBeGreaterThan(0);
  });
});
