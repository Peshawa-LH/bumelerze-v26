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

import { CLUSTER_CIRCLE_LAYER_ID, CLUSTER_MAX_ZOOM, CLUSTER_SOURCE_ID } from "@/features/map";
import {
  makeEvent,
  MockAttributionControl,
  MockMap,
  mockMapConstructorOptions,
  mockMapFitBounds,
  mockMapInstances,
  MockMarker,
  mockMarkerConstructorOptions,
  mockGetRTLTextPluginStatus,
  MOCK_DATA_UPDATED_AT,
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

  it("re-clusters when the map's zoom settles, splitting a badge back into individual markers as the user zooms in", async () => {
    setMockNextMapZoom(4);
    mockUseRegionEvents.mockReturnValue({
      events: [
        makeEvent({ id: "a", lat: 35.56, lon: 45.43 }),
        makeEvent({ id: "b", lat: 35.56, lon: 45.43 }),
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

    await waitFor(() => expect(mockMarkerConstructorOptions).toHaveLength(2));
  });

  it("clicking a cluster badge fits the viewport to its member events' bounds", async () => {
    setMockNextMapZoom(4);
    mockUseRegionEvents.mockReturnValue({
      events: [
        makeEvent({ id: "a", lat: 35.5, lon: 45.4 }),
        makeEvent({ id: "b", lat: 35.6, lon: 45.5 }),
      ],
      dataUpdatedAt: MOCK_DATA_UPDATED_AT,
    });

    await renderWithProviders(<MapScreenWeb />);
    await waitFor(() => {
      expect(findClusterSetDataCall()).toBeDefined();
    });

    const map = mockMapInstances.at(-1)!;
    mockMapFitBounds.mockClear();
    await act(async () => {
      map.fireLayerEvent("click", CLUSTER_CIRCLE_LAYER_ID, {
        minLon: 45.4,
        maxLon: 45.5,
        minLat: 35.5,
        maxLat: 35.6,
      });
    });

    expect(mockMapFitBounds).toHaveBeenCalledWith(
      [
        [45.4, 35.5],
        [45.5, 35.6],
      ],
      expect.objectContaining({ padding: expect.anything() }),
    );
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
