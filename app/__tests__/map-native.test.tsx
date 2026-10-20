import AsyncStorage from "@react-native-async-storage/async-storage";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import type { ReactElement, ReactNode } from "react";
import { AccessibilityInfo, TurboModuleRegistry } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { APP_ORIGIN } from "@/config/urls";
import {
  makeEvent,
  MOCK_DATA_UPDATED_AT,
  testSafeAreaMetrics,
} from "@/features/map/__fixtures__/map-web-helpers";
import {
  EVENT_MARKERS_SOURCE_ID,
  overlayAnchorLayerId,
} from "@/features/map/native-layers";
import {
  clearStyleSessionCache,
  styleStorageKey,
  type StyleDocument,
} from "@/features/map/native-style";
import { OWN_LABELS_SOURCE_ID } from "@/features/map/own-labels";
import { useMapPreferencesStore } from "@/features/map/preferences-store";
import i18n, { isRTLLocale } from "@/i18n";

import MapScreen from "../(tabs)/(map)/map";

/**
 * Native (iOS/Android) Map tab. Metro resolves `map.tsx` for any non-web
 * build (`map.web.tsx` is the web's). Without MapLibre's native code (Expo
 * Go) it is a translated state; with it, the full map on MapLibre Native,
 * driven here through a recording mock of `@maplibre/maplibre-react-native`
 * and a fake style server (`fetch`).
 */

interface Recorded {
  id?: string;
  [key: string]: unknown;
}

const mockMapRenders: Recorded[] = [];
const mockCameraRenders: Recorded[] = [];
const mockSources = new Map<string, Recorded>();
const mockLayers = new Map<string, Recorded>();
const mockShowAttribution = jest.fn(async () => undefined);
const mockFitBounds = jest.fn();
const mockEaseTo = jest.fn();

jest.mock("@maplibre/maplibre-react-native", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  const { View } = jest.requireActual<typeof import("react-native")>("react-native");
  const source = (kind: string) =>
    function MockSource(props: Recorded & { children?: ReactNode }) {
      mockSources.set(String(props.id), { ...props, kind });
      return React.createElement(View, { testID: `source-${props.id}` }, props.children);
    };
  return {
    Map: (props: Recorded & { ref?: unknown; children?: ReactNode }) => {
      mockMapRenders.push(props);
      React.useImperativeHandle(props.ref as never, () => ({
        showAttribution: mockShowAttribution,
        project: async ([lon, lat]: [number, number]) => [lon * 10, lat * 10],
        unproject: async ([x, y]: [number, number]) => [x / 10, y / 10],
      }));
      return React.createElement(View, { testID: "native-map" }, props.children);
    },
    Camera: (props: Recorded & { ref?: unknown }) => {
      mockCameraRenders.push(props);
      React.useImperativeHandle(props.ref as never, () => ({
        fitBounds: mockFitBounds,
        easeTo: mockEaseTo,
      }));
      return null;
    },
    GeoJSONSource: source("geojson"),
    ImageSource: source("image"),
    Layer: (props: Recorded) => {
      mockLayers.set(String(props.id), props);
      return null;
    },
  };
});

jest.mock("expo-router", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy require inside a jest.mock factory
  const { useEffect } = require("react");
  return {
    useFocusEffect: (effect: () => void | (() => void)) => {
      useEffect(() => effect(), [effect]);
    },
    useRouter: () => ({ push: jest.fn() }),
  };
});

const mockUseRegionEvents = jest.fn();
const mockUseWorldEvents = jest.fn();
jest.mock("@/features/events", () => {
  const actual = jest.requireActual("@/features/events");
  return {
    ...actual,
    useRegionEvents: () => mockUseRegionEvents(),
    useWorldEvents: () => mockUseWorldEvents(),
  };
});

const mockUseUserDistanceAnchor = jest.fn();
jest.mock("@/features/location/use-user-distance-anchor", () => ({
  useUserDistanceAnchor: () => mockUseUserDistanceAnchor(),
}));
// The preview sheet reads the same anchor through the feature index.
jest.mock("@/features/location", () => ({
  useUserDistanceAnchor: () => mockUseUserDistanceAnchor(),
}));

const STYLE: StyleDocument = {
  version: 8,
  sources: { planet: { type: "vector" } },
  layers: [
    { id: "water", type: "fill" },
    { id: "roads", type: "line" },
    {
      id: "place-city",
      type: "symbol",
      layout: {
        "text-field": ["get", "name"],
        "text-font": ["Open Sans Medium", "Noto Sans Medium"],
      },
    },
  ],
};

/** URLs the fake style server refuses (a bad MapTiler key, offline). */
let failingStyleUrls: RegExp[] = [];
const fetchedUrls: string[] = [];
const originalFetch = global.fetch;

function installStyleServer() {
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    fetchedUrls.push(url);
    if (failingStyleUrls.some((pattern) => pattern.test(url))) {
      throw new TypeError("Network request failed");
    }
    return { ok: true, status: 200, json: async () => STYLE } as Response;
  }) as typeof fetch;
}

function lastMapProps(): Recorded {
  const props = mockMapRenders[mockMapRenders.length - 1];
  if (!props) throw new Error("the native map was never rendered");
  return props;
}

function mapStyleLayers(): { id: string; layout?: Record<string, unknown> }[] {
  return (lastMapProps().mapStyle as StyleDocument).layers;
}

const ORIGINAL_MAPTILER_KEY = process.env.EXPO_PUBLIC_MAPTILER_KEY;
function setMapTilerKey(value: string | undefined): void {
  // Same `process.env` object, never a replacement: the transformed modules
  // keep a reference to it from import time.
  if (value === undefined) delete process.env.EXPO_PUBLIC_MAPTILER_KEY;
  else process.env.EXPO_PUBLIC_MAPTILER_KEY = value;
}

function renderMap(ui: ReactElement = <MapScreen />) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider initialMetrics={testSafeAreaMetrics}>{ui}</SafeAreaProvider>
    </QueryClientProvider>,
  );
}

async function loadMap() {
  await renderMap();
  await waitFor(() => expect(mockMapRenders.length).toBeGreaterThan(0));
  await act(async () => {
    (lastMapProps().onDidFinishLoadingMap as () => void)();
  });
}

describe("Native Map tab without MapLibre's native code (Expo Go)", () => {
  const originalLanguage = i18n.language;
  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage(originalLanguage);
  });

  it("renders the Sorani (RTL) translated 'needs a full installation' state", async () => {
    expect(isRTLLocale("ckb")).toBe(true);
    await i18n.changeLanguage("ckb");
    await renderMap();
    expect(screen.getByText(i18n.t("map.title"))).toBeTruthy();
    expect(screen.getByText(i18n.t("map.nativeUnavailableDescription"))).toBeTruthy();
  });

  it("renders the English (LTR) state and no map", async () => {
    await i18n.changeLanguage("en");
    await renderMap();
    expect(screen.getByText("Map")).toBeTruthy();
    expect(screen.queryByTestId("native-map")).toBeNull();
  });
});

describe("Native Map tab on MapLibre Native", () => {
  const regionEvents = [
    makeEvent({
      id: "old",
      originTime: MOCK_DATA_UPDATED_AT - 86_400_000,
      magnitude: { value: 3.1, type: "ml" },
    }),
    makeEvent({
      id: "new",
      originTime: MOCK_DATA_UPDATED_AT - 3_600_000,
      lat: 36.19,
      lon: 44.01,
      magnitude: { value: 5.4, type: "mw" },
    }),
  ];
  const worldEvents = [
    makeEvent({
      id: "world-1",
      lat: 38,
      lon: 142,
      magnitude: { value: 6.1, type: "mw" },
    }),
  ];
  const originalLanguage = i18n.language;

  beforeEach(async () => {
    mockMapRenders.length = 0;
    mockCameraRenders.length = 0;
    mockSources.clear();
    mockLayers.clear();
    fetchedUrls.length = 0;
    failingStyleUrls = [];
    mockFitBounds.mockClear();
    mockEaseTo.mockClear();
    mockShowAttribution.mockClear();
    clearStyleSessionCache();
    await AsyncStorage.clear();
    installStyleServer();
    jest
      .spyOn(TurboModuleRegistry, "get")
      .mockImplementation((name: string) =>
        name === "MLRNMapViewModule" ? ({} as never) : null,
      );
    mockUseRegionEvents.mockReturnValue({
      events: regionEvents,
      dataUpdatedAt: MOCK_DATA_UPDATED_AT,
    });
    mockUseWorldEvents.mockReturnValue({
      events: worldEvents,
      dataUpdatedAt: MOCK_DATA_UPDATED_AT,
    });
    mockUseUserDistanceAnchor.mockReturnValue({ hasFix: false, lat: null, lon: null });
    useMapPreferencesStore.setState({
      styleId: "outdoor",
      overlays: {},
      hasHydrated: true,
    });
    setMapTilerKey("test-key");
    await i18n.changeLanguage("en");
  });

  afterEach(async () => {
    cleanup();
    jest.restoreAllMocks();
    global.fetch = originalFetch;
    setMapTilerKey(ORIGINAL_MAPTILER_KEY);
    await i18n.changeLanguage(originalLanguage);
  });

  it("loads the web's MapTiler style document and opens on the region, like the web map", async () => {
    await renderMap();
    await waitFor(() => expect(mockMapRenders.length).toBeGreaterThan(0));
    expect(fetchedUrls[0]).toMatch(
      /^https:\/\/api\.maptiler\.com\/maps\/outdoor-v4(-dark)?\/style\.json\?key=test-key$/,
    );
    expect(lastMapProps().logo).toBe(false);
    expect(lastMapProps().attribution).toBe(false);
    expect(mockCameraRenders[mockCameraRenders.length - 1]?.initialViewState).toEqual({
      bounds: [41, 33, 48.5, 38.5],
      padding: { top: 32, right: 32, bottom: 32, left: 32 },
    });
    // Hillshade under the roads; the overlay placeholders under the labels.
    expect(mapStyleLayers().map((layer) => layer.id)).toEqual([
      "water",
      "bumelerze-terrain-hillshade",
      "roads",
      overlayAnchorLayerId("site-vs30"),
      overlayAnchorLayerId("faults-gem"),
      overlayAnchorLayerId("faults-afead"),
      overlayAnchorLayerId("historical-quakes"),
      "place-city",
    ]);
  });

  it("covers the map with 'Loading map…' until the style has loaded", async () => {
    await renderMap();
    await waitFor(() => expect(mockMapRenders.length).toBeGreaterThan(0));
    expect(screen.getByText("Loading map…")).toBeTruthy();
    await act(async () => {
      (lastMapProps().onDidFinishLoadingMap as () => void)();
    });
    expect(screen.queryByText("Loading map…")).toBeNull();
  });

  it("uses OpenFreeMap when no MapTiler key is configured", async () => {
    setMapTilerKey(undefined);
    await renderMap();
    await waitFor(() => expect(mockMapRenders.length).toBeGreaterThan(0));
    expect(fetchedUrls[0]).toMatch(/^https:\/\/tiles\.openfreemap\.org\/styles\//);
  });

  it("falls back to OpenFreeMap once, then shows the offline state with a Retry that starts over", async () => {
    failingStyleUrls = [/api\.maptiler\.com/];
    await renderMap();
    await waitFor(() => expect(mockMapRenders.length).toBeGreaterThan(0));
    expect(fetchedUrls).toEqual([
      expect.stringMatching(/api\.maptiler\.com/),
      expect.stringMatching(/tiles\.openfreemap\.org/),
    ]);

    await act(async () => {
      (lastMapProps().onDidFailLoadingMap as () => void)();
    });
    expect(screen.getByText("Map unavailable offline")).toBeTruthy();
    expect(screen.queryByTestId("native-map")).toBeNull();

    failingStyleUrls = [];
    await act(async () => {
      fireEvent.press(screen.getByText("Retry"));
    });
    await waitFor(() =>
      expect(fetchedUrls[fetchedUrls.length - 1]).toMatch(/api\.maptiler\.com/),
    );
  });

  it("opens offline on the style saved by an earlier run, MapTiler included", async () => {
    for (const id of ["outdoor-v4", "outdoor-v4-dark"]) {
      await AsyncStorage.setItem(
        styleStorageKey(`https://api.maptiler.com/maps/${id}/style.json?key=old-key`),
        JSON.stringify(STYLE),
      );
    }
    failingStyleUrls = [/./];
    await renderMap();
    await waitFor(() => expect(mockMapRenders.length).toBeGreaterThan(0));
    // One failed request and no fall-back: the saved MapTiler document
    // (saved under a key since rotated) is what the map gets.
    expect(fetchedUrls).toEqual([expect.stringMatching(/api\.maptiler\.com/)]);
    expect(mapStyleLayers().map((layer) => layer.id)).toContain("place-city");
  });

  it("waits for the saved style choice before loading anything", async () => {
    useMapPreferencesStore.setState({ styleId: "topo", hasHydrated: false });
    await renderMap();
    expect(fetchedUrls).toEqual([]);
    expect(screen.queryByTestId("native-map")).toBeNull();
    await act(async () => {
      useMapPreferencesStore.setState({ hasHydrated: true });
    });
    await waitFor(() => expect(fetchedUrls[0]).toMatch(/\/maps\/topo-v4(-dark)?\//));
  });

  it("[regression] opens the map credits from its own 44 pt button, and shows MapTiler's logo", async () => {
    await loadMap();
    const credits = screen.getByLabelText("Map credits");
    expect(credits).toHaveStyle({ width: 44, height: 44 });
    await act(async () => {
      fireEvent.press(credits);
    });
    expect(mockShowAttribution).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("MapTiler")).toBeTruthy();
  });

  it("draws every event from ONE source, with the most recent last", async () => {
    await loadMap();
    const events = mockSources.get(EVENT_MARKERS_SOURCE_ID);
    const data = events?.data as {
      features: { id: string; properties: Record<string, unknown> }[];
    };
    expect(data.features.map((feature) => feature.id)).toEqual(["old", "new"]);
    expect(data.features[1]?.properties).toMatchObject({ recent: true });
    expect(events?.hitbox).toEqual({ top: 22, right: 22, bottom: 22, left: 22 });
    expect(mockLayers.has("bumelerze-events-core")).toBe(true);
  });

  it("opens the preview sheet on a marker tap and settles the event above it", async () => {
    const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility");
    await loadMap();
    const onPress = mockSources.get(EVENT_MARKERS_SOURCE_ID)?.onPress as (
      event: unknown,
    ) => void;
    const stopPropagation = jest.fn();
    await act(async () => {
      onPress({
        stopPropagation,
        nativeEvent: {
          lngLat: [44.0, 36.2],
          point: [0, 0],
          features: [
            {
              geometry: { type: "Point", coordinates: [45.43, 35.56] },
              properties: { id: "old" },
            },
            {
              geometry: { type: "Point", coordinates: [44.01, 36.19] },
              properties: { id: "new" },
            },
          ],
        },
      });
    });
    expect(stopPropagation).toHaveBeenCalled();
    expect(screen.getByTestId("event-preview-sheet")).toBeTruthy();
    expect(screen.getByText("Open full event")).toBeTruthy();
    expect(announce).toHaveBeenCalledWith(expect.stringContaining("5.4"));
    // project → 90 pt lower → unproject: 9 "degrees" (90 / 10) further south.
    await waitFor(() => expect(mockEaseTo).toHaveBeenCalled());
    const [options] = mockEaseTo.mock.calls[0] ?? [];
    expect(options.center[0]).toBeCloseTo(44.01);
    expect(options.center[1]).toBeCloseTo(36.19 + 9);
  });

  it("frames the world, and the region again, on a scope switch", async () => {
    await loadMap();
    await act(async () => {
      fireEvent.press(screen.getByText("World"));
    });
    expect(mockFitBounds).toHaveBeenLastCalledWith(
      [-175, -58, 178, 75],
      expect.any(Object),
    );
    const world = mockSources.get(EVENT_MARKERS_SOURCE_ID)?.data as {
      features: unknown[];
    };
    expect(world.features).toHaveLength(1);
    await act(async () => {
      fireEvent.press(screen.getByText("Home"));
    });
    expect(mockFitBounds).toHaveBeenLastCalledWith(
      [41, 33, 48.5, 38.5],
      expect.any(Object),
    );
  });

  it("frames Home around the reader once a location fix is known", async () => {
    mockUseUserDistanceAnchor.mockReturnValue({ hasFix: true, lat: 35.56, lon: 45.43 });
    await loadMap();
    const [bounds] = mockFitBounds.mock.calls[0] ?? [];
    expect(bounds).toEqual([45.43 - 0.9, 35.56 - 0.7, 45.43 + 0.9, 35.56 + 0.7]);
  });

  it("declares the switched-on overlays from the web app's files, each under its own placeholder", async () => {
    useMapPreferencesStore.setState({
      overlays: { "faults-gem": true, "historical-quakes": true, "site-vs30": true },
    });
    await loadMap();
    expect(mockSources.get("bumelerze-faults")?.data).toEqual(
      expect.stringContaining(`${APP_ORIGIN}/data/gem-active-faults-region.geojson?v=`),
    );
    expect(mockSources.get("bumelerze-vs30")).toMatchObject({
      kind: "image",
      url: expect.stringContaining(`${APP_ORIGIN}/data/vs30-site-class.png`),
    });
    expect(mockLayers.get("bumelerze-faults-lines")?.beforeId).toBe(
      overlayAnchorLayerId("faults-gem"),
    );
    expect(mockLayers.get("bumelerze-historical-circles")?.beforeId).toBe(
      overlayAnchorLayerId("historical-quakes"),
    );
    expect(screen.getByTestId("map-overlay-legend")).toBeTruthy();
  });

  it("opens the info card for a tapped past earthquake", async () => {
    useMapPreferencesStore.setState({ overlays: { "historical-quakes": true } });
    await loadMap();
    const onPress = mockSources.get("bumelerze-historical")?.onPress as (
      event: unknown,
    ) => void;
    await act(async () => {
      onPress({
        stopPropagation: jest.fn(),
        nativeEvent: {
          lngLat: [45, 35],
          point: [0, 0],
          features: [
            {
              geometry: { type: "Point", coordinates: [45, 35] },
              properties: {
                id: "bml1962000g",
                m: 7,
                year: 1962,
                era: "early",
                mt: "Mw",
                d: 29,
                src: "ONUR2017",
              },
            },
          ],
        },
      });
    });
    expect(screen.getByText(/bml1962000g/)).toBeTruthy();
  });

  it("draws the own Kurdish labels with the style's own font, Sorani respelled for the shaper", async () => {
    await i18n.changeLanguage("ckb");
    await loadMap();
    expect(mockLayers.get("bumelerze-own-city-labels-symbol")?.layout).toMatchObject({
      "text-font": ["Open Sans Medium", "Noto Sans Medium"],
    });
    const labels = (
      mockSources.get(OWN_LABELS_SOURCE_ID)?.data as {
        features: { properties: { label: string } }[];
      }
    ).features.map((feature) => feature.properties.label);
    expect(labels.length).toBeGreaterThan(0);
    // ە never reaches MapLibre Native as itself (its shaper treats it as
    // non-joining: هەولێر read "ەەولێر" on the simulator).
    expect(labels.some((label) => label.includes("ە"))).toBe(false);
    expect(labels.some((label) => label.includes("‌"))).toBe(true);
    // Basemap names in Arabic script, as on the web.
    expect(
      mapStyleLayers().find((layer) => layer.id === "place-city")?.layout?.["text-field"],
    ).toEqual(["coalesce", ["get", "name:ar"], ["get", "name"]]);
  });

  it("swaps the style of the live map on a new style pick, without rebuilding the map", async () => {
    await loadMap();
    const mapCount = screen.getAllByTestId("native-map").length;
    await act(async () => {
      useMapPreferencesStore.getState().setStyleId("hybrid");
    });
    await waitFor(() =>
      expect(fetchedUrls[fetchedUrls.length - 1]).toMatch(/\/maps\/hybrid\//),
    );
    await waitFor(() =>
      expect((lastMapProps().mapStyle as StyleDocument).layers).toBeDefined(),
    );
    expect(screen.getAllByTestId("native-map")).toHaveLength(mapCount);
    expect(screen.queryByText("Loading map…")).toBeNull();
  });
});
