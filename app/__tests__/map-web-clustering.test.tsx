/**
 * @jest-environment jsdom
 *
 * Web Map screen (`app/(tabs)/map.web.tsx`) — event clustering (Problem 2:
 * "markers overlap into an unreadable blob"). See
 * `map-web-creation.test.tsx`'s doc comment for the jsdom-environment/
 * mocking rationale, and `DEFAULT_MOCK_MAP_ZOOM`'s doc comment
 * (`map-web-helpers.ts`) for why every OTHER map test file (none of which
 * calls `setMockNextMapZoom`) never exercises clustering at all — only
 * tests here deliberately drop the mock's zoom below `CLUSTER_MAX_ZOOM`.
 */
import {
  act,
  cleanup,
  render,
  waitFor,
  type RenderResult,
} from "@testing-library/react-native";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import {
  CLUSTER_CIRCLE_LAYER_ID,
  CLUSTER_EXPANSION_ZOOM_MARGIN,
  CLUSTER_MAX_ZOOM,
  CLUSTER_SOURCE_ID,
} from "@/features/map";
import {
  makeEvent,
  MockAttributionControl,
  MockMap,
  mockMapCameraForBounds,
  mockMapConstructorOptions,
  mockMapEaseTo,
  mockMapInstances,
  MockMarker,
  mockMarkerConstructorOptions,
  mockGetRTLTextPluginStatus,
  MOCK_DATA_UPDATED_AT,
  setMockCameraForBoundsResult,
  mockSetRTLTextPlugin,
  mockSetWorkerUrl,
  mockSourceSetData,
  mockUseRegionEvents,
  mockUseWorldEvents,
  resetMapWebMocks,
  setMockNextMapZoom,
  testSafeAreaMetrics,
} from "../__fixtures__/map-web-helpers";

jest.mock("expo-router", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy require required inside a jest.mock factory
  const { useEffect } = require("react");
  return {
    useFocusEffect: (effect: () => void | (() => void)) => {
      useEffect(() => effect(), [effect]);
    },
    useRouter: () => ({ push: jest.fn() }),
  };
});

jest.mock("@/features/events", () => {
  const actual = jest.requireActual("@/features/events");
  return {
    ...actual,
    useRegionEvents: () => mockUseRegionEvents(),
    useWorldEvents: () => mockUseWorldEvents(),
  };
});

// `{ virtual: true }`: maplibre-gl ships ESM-only — see
// map-web-creation.test.tsx.
jest.mock(
  "maplibre-gl",
  () => ({
    Map: MockMap,
    Marker: MockMarker,
    AttributionControl: MockAttributionControl,
    setWorkerUrl: mockSetWorkerUrl,
    setRTLTextPlugin: mockSetRTLTextPlugin,
    getRTLTextPluginStatus: mockGetRTLTextPluginStatus,
  }),
  { virtual: true },
);

// eslint-disable-next-line import/first -- see comment above
import MapScreenWeb from "../(tabs)/map.web";

async function renderWithProviders(ui: ReactElement): Promise<RenderResult> {
  return render(
    <SafeAreaProvider initialMetrics={testSafeAreaMetrics}>{ui}</SafeAreaProvider>,
  );
}

function findClusterSetDataCall() {
  return mockSourceSetData.mock.calls.find(([sourceId]) => sourceId === CLUSTER_SOURCE_ID) as
    | [string, { features: { properties: { count: number } }[] }]
    | undefined;
}

beforeEach(() => {
  resetMapWebMocks();
});

afterEach(() => {
  cleanup();
});

describe("MapScreenWeb clustering", () => {
  it("clusters dense nearby events into one GL badge below the threshold zoom, with no individual DOM markers for them", async () => {
    setMockNextMapZoom(4);
    mockUseRegionEvents.mockReturnValue({
      events: [
        makeEvent({ id: "a", lat: 35.56, lon: 45.43 }),
        makeEvent({ id: "b", lat: 35.56, lon: 45.43 }),
        makeEvent({ id: "c", lat: 35.56, lon: 45.43 }),
      ],
      dataUpdatedAt: MOCK_DATA_UPDATED_AT,
    });

    await renderWithProviders(<MapScreenWeb />);

    await waitFor(() => {
      expect(findClusterSetDataCall()).toBeDefined();
    });
    const [, featureCollection] = findClusterSetDataCall()!;
    expect(featureCollection.features).toHaveLength(1);
    expect(featureCollection.features[0]?.properties.count).toBe(3);

    // All 3 events are swallowed into the single cluster badge above —
    // zero individual DOM markers for them.
    expect(mockMarkerConstructorOptions).toHaveLength(0);
  });

  it("keeps individual DOM markers (empty cluster source) at the default test zoom, unchanged from before clustering existed", async () => {
    mockUseRegionEvents.mockReturnValue({
      events: [
        makeEvent({ id: "a", lat: 35.56, lon: 45.43 }),
        makeEvent({ id: "b", lat: 35.56, lon: 45.43 }),
      ],
      dataUpdatedAt: MOCK_DATA_UPDATED_AT,
    });

    await renderWithProviders(<MapScreenWeb />);

    await waitFor(() => expect(mockMarkerConstructorOptions).toHaveLength(2));
    const [, featureCollection] = findClusterSetDataCall()!;
    expect(featureCollection.features).toHaveLength(0);
  });

  it("never clusters a group of only 2 events, however close, at any zoom below the cutoff", async () => {
    // Regression: a below-minimum-size "cluster" hides more than it helps
    // (wave brief) — two co-located events must render as two standalone,
    // individually tappable markers, not a badge, even deep below
    // CLUSTER_MAX_ZOOM.
    setMockNextMapZoom(4);
    mockUseRegionEvents.mockReturnValue({
      events: [
        makeEvent({ id: "a", lat: 35.56, lon: 45.43 }),
        makeEvent({ id: "b", lat: 35.56, lon: 45.43 }),
      ],
      dataUpdatedAt: MOCK_DATA_UPDATED_AT,
    });

    await renderWithProviders(<MapScreenWeb />);

    await waitFor(() => expect(mockMarkerConstructorOptions).toHaveLength(2));
    const [, featureCollection] = findClusterSetDataCall()!;
    expect(featureCollection.features).toHaveLength(0);
  });

  it("re-clusters when the map's zoom settles, splitting a badge back into individual markers as the user zooms in", async () => {
    setMockNextMapZoom(4);
    mockUseRegionEvents.mockReturnValue({
      events: [
        makeEvent({ id: "a", lat: 35.56, lon: 45.43 }),
        makeEvent({ id: "b", lat: 35.56, lon: 45.43 }),
        makeEvent({ id: "c", lat: 35.56, lon: 45.43 }),
      ],
      dataUpdatedAt: MOCK_DATA_UPDATED_AT,
    });

    await renderWithProviders(<MapScreenWeb />);
    await waitFor(() => expect(mockMapConstructorOptions).toHaveLength(1));
    await waitFor(() => expect(mockMarkerConstructorOptions).toHaveLength(0));

    const map = mockMapInstances.at(-1)!;
    await act(async () => {
      map.setZoomAndFireZoomEnd(CLUSTER_MAX_ZOOM);
    });

    await waitFor(() => expect(mockMarkerConstructorOptions).toHaveLength(3));
  });

  it("clicking a cluster badge eases the viewport to its member events' bounds", async () => {
    setMockNextMapZoom(4);
    setMockCameraForBoundsResult({ center: [45.45, 35.55], zoom: CLUSTER_MAX_ZOOM + 2 });
    mockUseRegionEvents.mockReturnValue({
      events: [
        makeEvent({ id: "a", lat: 35.5, lon: 45.4 }),
        makeEvent({ id: "b", lat: 35.55, lon: 45.45 }),
        makeEvent({ id: "c", lat: 35.6, lon: 45.5 }),
      ],
      dataUpdatedAt: MOCK_DATA_UPDATED_AT,
    });

    await renderWithProviders(<MapScreenWeb />);
    await waitFor(() => {
      expect(findClusterSetDataCall()).toBeDefined();
    });

    const map = mockMapInstances.at(-1)!;
    mockMapCameraForBounds.mockClear();
    mockMapEaseTo.mockClear();
    await act(async () => {
      map.fireLayerEvent("click", CLUSTER_CIRCLE_LAYER_ID, {
        minLon: 45.4,
        maxLon: 45.5,
        minLat: 35.5,
        maxLat: 35.6,
      });
    });

    expect(mockMapCameraForBounds).toHaveBeenCalledWith(
      [
        [45.4, 35.5],
        [45.5, 35.6],
      ],
      expect.objectContaining({ padding: expect.anything() }),
    );
    // The natural fit's own zoom (already comfortably past the cutoff) is
    // used as-is — no need to force a bigger jump than the bounds fit
    // already gives.
    expect(mockMapEaseTo).toHaveBeenCalledWith(
      expect.objectContaining({ center: [45.45, 35.55], zoom: CLUSTER_MAX_ZOOM + 2 }),
    );
  });

  it("forces the zoom past the cutoff when the cluster's natural bounds-fit wouldn't clear it — a badge tap always makes progress", async () => {
    // Regression for the reported bug: a wide-spread cluster's fit-bounds
    // zoom can land AT/BELOW CLUSTER_MAX_ZOOM, which — with the old plain
    // `fitBounds` call — re-clustered the exact same members into the same
    // badge (a tap that visibly changes nothing). `cameraForBounds` here
    // reports a natural zoom still below the cutoff; the resulting camera
    // move must clear it anyway.
    setMockNextMapZoom(4);
    setMockCameraForBoundsResult({ center: [45, 35], zoom: CLUSTER_MAX_ZOOM - 2 });
    mockUseRegionEvents.mockReturnValue({
      events: [
        makeEvent({ id: "a", lat: 33.5, lon: 42 }),
        makeEvent({ id: "b", lat: 34, lon: 42.5 }),
        makeEvent({ id: "c", lat: 34.5, lon: 43 }),
      ],
      dataUpdatedAt: MOCK_DATA_UPDATED_AT,
    });

    await renderWithProviders(<MapScreenWeb />);
    await waitFor(() => {
      expect(findClusterSetDataCall()).toBeDefined();
    });

    const map = mockMapInstances.at(-1)!;
    mockMapEaseTo.mockClear();
    await act(async () => {
      map.fireLayerEvent("click", CLUSTER_CIRCLE_LAYER_ID, {
        minLon: 42,
        maxLon: 43,
        minLat: 33.5,
        maxLat: 34.5,
      });
    });

    expect(mockMapEaseTo).toHaveBeenCalledTimes(1);
    const [easeToOptions] = mockMapEaseTo.mock.calls[0] as [{ zoom: number }];
    expect(easeToOptions.zoom).toBeGreaterThan(CLUSTER_MAX_ZOOM);
    expect(easeToOptions.zoom).toBe(CLUSTER_MAX_ZOOM + CLUSTER_EXPANSION_ZOOM_MARGIN);
  });

  it("does nothing if the cluster's bounds can't be resolved to a camera (no undefined-camera crash)", async () => {
    setMockNextMapZoom(4);
    setMockCameraForBoundsResult(undefined);
    mockUseRegionEvents.mockReturnValue({
      events: [
        makeEvent({ id: "a", lat: 35.5, lon: 45.4 }),
        makeEvent({ id: "b", lat: 35.55, lon: 45.45 }),
        makeEvent({ id: "c", lat: 35.6, lon: 45.5 }),
      ],
      dataUpdatedAt: MOCK_DATA_UPDATED_AT,
    });

    await renderWithProviders(<MapScreenWeb />);
    await waitFor(() => {
      expect(findClusterSetDataCall()).toBeDefined();
    });

    const map = mockMapInstances.at(-1)!;
    mockMapEaseTo.mockClear();
    await act(async () => {
      map.fireLayerEvent("click", CLUSTER_CIRCLE_LAYER_ID, {
        minLon: 45.4,
        maxLon: 45.5,
        minLat: 35.5,
        maxLat: 35.6,
      });
    });

    expect(mockMapEaseTo).not.toHaveBeenCalled();
  });

  it("gives the single most-recent standalone marker a distinct outline treatment", async () => {
    mockUseRegionEvents.mockReturnValue({
      events: [
        makeEvent({ id: "old", lat: 30, lon: 30, originTime: MOCK_DATA_UPDATED_AT - 10_000 }),
        makeEvent({ id: "new", lat: -10, lon: -80, originTime: MOCK_DATA_UPDATED_AT }),
      ],
      dataUpdatedAt: MOCK_DATA_UPDATED_AT,
    });

    await renderWithProviders(<MapScreenWeb />);
    await waitFor(() => expect(mockMarkerConstructorOptions).toHaveLength(2));

    const [oldMarker, newMarker] = mockMarkerConstructorOptions;
    const oldHalo = oldMarker!.element.firstElementChild as HTMLElement;
    const newHalo = newMarker!.element.firstElementChild as HTMLElement;
    expect(newHalo.style.border).toContain("2.5px");
    expect(oldHalo.style.border).not.toContain("2.5px");
  });
});
