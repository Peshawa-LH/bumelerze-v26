import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import type { ReactNode } from "react";
import { TurboModuleRegistry } from "react-native";

import { clearStyleSessionCache, type StyleDocument } from "@/features/map/native-style";
import i18n from "@/i18n";
import damageContoursFixture from "../__fixtures__/us6000jllz/cont_damage.trimmed.json";
import halabjaContours from "../__fixtures__/us2000bmcg/cont_mi.trimmed.json";
import { SHAKEMAP_BANDS_ANCHOR_ID } from "../components/ShakeMapViewNative";
import { ShakeMapView } from "../components/ShakeMapView";
import { parseIntensityContours } from "../contours";
import { parseDamageContours } from "../risk";
import {
  SHAKEMAP_WEB_DAMAGE_FILL_LAYER_ID,
  SHAKEMAP_WEB_INTENSITY_FILL_LAYER_ID,
  SHAKEMAP_WEB_INTENSITY_LINE_LAYER_ID,
  SHAKEMAP_WEB_INTENSITY_SOURCE_ID,
} from "../web-map";

/**
 * The event page's SHAKEmap on MapLibre Native (iOS/Android), through a
 * recording mock of `@maplibre/maplibre-react-native` and a fake style
 * server. `ShakeMapView.test.tsx` covers the SVG map, which is what this
 * entry point shows without MapLibre's native code (Expo Go, plain Jest).
 */

interface Recorded {
  id?: string;
  [key: string]: unknown;
}

const mockMapRenders: Recorded[] = [];
const mockCameraRenders: Recorded[] = [];
const mockLayers = new Map<string, Recorded>();
const mockSources = new Map<string, Recorded>();
const mockAnnotations: Recorded[] = [];
const mockZoomTo = jest.fn();

jest.mock("@maplibre/maplibre-react-native", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  const { View } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    Map: function MockMap(props: Recorded & { ref?: unknown; children?: ReactNode }) {
      mockMapRenders.push(props);
      React.useImperativeHandle(props.ref as never, () => ({
        getZoom: async () => 7,
        showAttribution: async () => undefined,
      }));
      return React.createElement(View, { testID: "shakemap-native-map" }, props.children);
    },
    Camera: function MockCamera(props: Recorded & { ref?: unknown }) {
      mockCameraRenders.push(props);
      React.useImperativeHandle(props.ref as never, () => ({ zoomTo: mockZoomTo }));
      return null;
    },
    GeoJSONSource: function MockSource(props: Recorded & { children?: ReactNode }) {
      mockSources.set(String(props.id), props);
      return React.createElement(View, null, props.children);
    },
    Layer: function MockLayer(props: Recorded) {
      mockLayers.set(String(props.id), props);
      return null;
    },
    ViewAnnotation: function MockAnnotation(props: Recorded & { children?: ReactNode }) {
      mockAnnotations.push(props);
      return React.createElement(View, null, props.children);
    },
  };
});

const STYLE: StyleDocument = {
  version: 8,
  sources: { planet: { type: "vector" } },
  layers: [
    { id: "water", type: "fill" },
    {
      id: "place-city",
      type: "symbol",
      layout: { "text-field": ["get", "name"] },
    },
  ],
};

let styleServerFails = false;
const originalFetch = global.fetch;
const HALABJA_EPICENTER = { lat: 34.9109, lon: 45.9592 };

function renderShakeMap(withDamage = false) {
  return render(
    <ShakeMapView
      contours={parseIntensityContours(halabjaContours)}
      epicenter={HALABJA_EPICENTER}
      locale="en"
      t={i18n.t}
      placeText="30 km S of Halabja"
      damageContours={withDamage ? parseDamageContours(damageContoursFixture) : null}
    />,
  );
}

function lastMap(): Recorded {
  const props = mockMapRenders[mockMapRenders.length - 1];
  if (!props) throw new Error("no native map");
  return props;
}

describe("ShakeMapView on MapLibre Native", () => {
  beforeEach(async () => {
    mockMapRenders.length = 0;
    mockCameraRenders.length = 0;
    mockLayers.clear();
    mockSources.clear();
    mockAnnotations.length = 0;
    mockZoomTo.mockClear();
    styleServerFails = false;
    clearStyleSessionCache();
    await AsyncStorage.clear();
    global.fetch = jest.fn(async () => {
      if (styleServerFails) throw new TypeError("Network request failed");
      return { ok: true, status: 200, json: async () => STYLE } as Response;
    }) as typeof fetch;
    jest
      .spyOn(TurboModuleRegistry, "get")
      .mockImplementation((name: string) =>
        name === "MLRNMapViewModule" ? ({} as never) : null,
      );
    await i18n.changeLanguage("en");
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
    global.fetch = originalFetch;
  });

  it("draws the intensity bands under the labels, fitted to the contours and the epicentre", async () => {
    await renderShakeMap();
    await waitFor(() => expect(mockMapRenders.length).toBeGreaterThan(0));
    const style = lastMap().mapStyle as StyleDocument;
    expect(style.layers.map((layer) => layer.id)).toEqual([
      "water",
      "bumelerze-terrain-hillshade",
      SHAKEMAP_BANDS_ANCHOR_ID,
      "place-city",
    ]);
    const source = mockSources.get(SHAKEMAP_WEB_INTENSITY_SOURCE_ID);
    expect((source?.data as { features: unknown[] }).features.length).toBeGreaterThan(0);
    expect(mockLayers.get(SHAKEMAP_WEB_INTENSITY_FILL_LAYER_ID)).toMatchObject({
      type: "fill",
      beforeId: SHAKEMAP_BANDS_ANCHOR_ID,
      layout: { visibility: "visible" },
      paint: { "fill-opacity": 0.4 },
    });
    expect(mockLayers.get(SHAKEMAP_WEB_INTENSITY_LINE_LAYER_ID)).toMatchObject({
      type: "line",
      paint: { "line-width": 0.75, "line-opacity": 0.8 },
    });
    const view = mockCameraRenders[mockCameraRenders.length - 1]?.initialViewState as {
      bounds: number[];
    };
    const [west, south, east, north] = view.bounds;
    expect(west).toBeLessThanOrEqual(HALABJA_EPICENTER.lon);
    expect(east).toBeGreaterThanOrEqual(HALABJA_EPICENTER.lon);
    expect(south).toBeLessThanOrEqual(HALABJA_EPICENTER.lat);
    expect(north).toBeGreaterThanOrEqual(HALABJA_EPICENTER.lat);
    expect(mockAnnotations[0]?.lngLat).toEqual([45.9592, 34.9109]);
    // One finger scrolls the event page (the web's cooperative gestures).
    expect(lastMap().dragPan).toBe(false);
  });

  it("keeps the style's own place names in every language, as the web's SHAKEmap does", async () => {
    await i18n.changeLanguage("ckb");
    await renderShakeMap();
    await waitFor(() => expect(mockMapRenders.length).toBeGreaterThan(0));
    const style = lastMap().mapStyle as StyleDocument;
    expect(style.layers.find((layer) => layer.id === "place-city")?.layout).toEqual({
      "text-field": ["get", "name"],
    });
  });

  it("switches to the damage bands with the shared toggle", async () => {
    await renderShakeMap(true);
    await waitFor(() => expect(mockMapRenders.length).toBeGreaterThan(0));
    expect(mockLayers.get(SHAKEMAP_WEB_DAMAGE_FILL_LAYER_ID)?.layout).toEqual({
      visibility: "none",
    });
    await act(async () => {
      fireEvent.press(screen.getByText("Damage"));
    });
    expect(mockLayers.get(SHAKEMAP_WEB_DAMAGE_FILL_LAYER_ID)?.layout).toEqual({
      visibility: "visible",
    });
    expect(mockLayers.get(SHAKEMAP_WEB_INTENSITY_FILL_LAYER_ID)?.layout).toEqual({
      visibility: "none",
    });
    expect(screen.getByLabelText(/SHAKEmap damage map/)).toBeTruthy();
  });

  it("zooms with 44 pt buttons once the map has loaded", async () => {
    await renderShakeMap();
    await waitFor(() => expect(mockMapRenders.length).toBeGreaterThan(0));
    await act(async () => {
      (lastMap().onDidFinishLoadingMap as () => void)();
    });
    const zoomIn = screen.getByLabelText("Zoom in");
    expect(zoomIn).toHaveStyle({ width: 44, height: 44 });
    await act(async () => {
      fireEvent.press(zoomIn);
    });
    await waitFor(() => expect(mockZoomTo).toHaveBeenCalledWith(8, { duration: 200 }));
    expect(screen.getByLabelText("Map credits")).toBeTruthy();
  });

  it("shows the SVG map when no map can be shown at all, as the web does", async () => {
    styleServerFails = true;
    await renderShakeMap();
    await waitFor(() => expect(mockMapRenders.length).toBeGreaterThan(0));
    await act(async () => {
      (lastMap().onDidFailLoadingMap as () => void)();
    });
    expect(screen.queryByTestId("shakemap-native-map")).toBeNull();
    // The SVG renderer's own legend and container.
    expect(screen.getByTestId("shakemap-map-container")).toBeTruthy();
  });
});
