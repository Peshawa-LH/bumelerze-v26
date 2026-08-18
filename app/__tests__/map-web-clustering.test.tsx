/**
 * @jest-environment jsdom
 *
 * Web Map screen (`app/(tabs)/map.web.tsx`) — event clustering (Problem 2:
 * "markers overlap into an unreadable blob") AND the cluster-tap-reveals-
 * events fix (a badge tap must always reveal something — a member LIST for
 * a small cluster, a guaranteed-progress zoom for a large one — never just
 * move the camera with nothing visibly different to show for it). See
 * `map-web-creation.test.tsx`'s doc comment for the jsdom-environment/
 * mocking rationale, and `DEFAULT_MOCK_MAP_ZOOM`'s doc comment
 * (`map-web-helpers.ts`) for why every OTHER map test file (none of which
 * calls `setMockNextMapZoom`) never exercises clustering at all — only
 * tests here deliberately drop the mock's zoom below `CLUSTER_MAX_ZOOM`.
 */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  type RenderResult,
} from "@testing-library/react-native";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import i18n from "@/i18n";
import {
  CLUSTER_CIRCLE_LAYER_ID,
  CLUSTER_EXPANSION_ZOOM_MARGIN,
  CLUSTER_LIST_MAX_SIZE,
  CLUSTER_MAX_ZOOM,
  CLUSTER_SOURCE_ID,
  MAP_INITIAL_MIN_ZOOM_COMPACT,
} from "@/features/map";
import {
  makeEvent,
  MockAttributionControl,
  MockMap,
  mockMapCameraForBounds,
  mockMapConstructorOptions,
  mockMapEaseTo,
  mockMapInstances,
  mockMapJumpTo,
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

const ORIGINAL_INNER_WIDTH = window.innerWidth;

/** Same pattern `map-web-controls.test.tsx` already established for
 * exercising this screen's other compact-width behavior. */
function setWindowWidth(width: number): void {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
}

async function renderWithProviders(ui: ReactElement): Promise<RenderResult> {
  return render(
    <SafeAreaProvider initialMetrics={testSafeAreaMetrics}>{ui}</SafeAreaProvider>,
  );
}

function findClusterSetDataCall() {
  return mockSourceSetData.mock.calls.find(([sourceId]) => sourceId === CLUSTER_SOURCE_ID) as
    | [string, { features: { properties: Record<string, unknown> }[] }]
    | undefined;
}

/** Builds `count` co-located events (all cluster together regardless of
 * count — clustering only cares about on-screen pixel proximity at the
 * given zoom, not raw count) with distinct ids, for the LARGE-cluster (past
 * `CLUSTER_LIST_MAX_SIZE`) test scenarios below. */
function makeManyCoLocatedEvents(count: number) {
  return Array.from({ length: count }, (_, index) =>
    makeEvent({ id: `many-${index}`, lat: 35.56, lon: 45.43 }),
  );
}

beforeEach(() => {
  resetMapWebMocks();
});

afterEach(() => {
  cleanup();
  setWindowWidth(ORIGINAL_INNER_WIDTH);
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

describe("MapScreenWeb clustering: cluster tap always reveals something (cluster-tap-reveals-events fix)", () => {
  it("tapping a cluster AT/BELOW the list threshold opens the preview sheet in LIST mode with every member as a row, instead of just moving the camera", async () => {
    setMockNextMapZoom(4);
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
    const [, featureCollection] = findClusterSetDataCall()!;
    expect(featureCollection.features).toHaveLength(1);
    expect(featureCollection.features[0]?.properties.count).toBe(3);

    const map = mockMapInstances.at(-1)!;
    mockMapCameraForBounds.mockClear();
    mockMapEaseTo.mockClear();
    await act(async () => {
      // Real properties straight off the feature the screen itself just
      // built (`id`/`count`/bounds) — not hand-typed partial bounds, so this
      // test can never drift out of sync with what `clustering.ts` actually
      // produces.
      map.fireLayerEvent(
        "click",
        CLUSTER_CIRCLE_LAYER_ID,
        featureCollection.features[0]!.properties,
      );
    });

    // The LIST path never calls `cameraForBounds`/forces a zoom — that's
    // the OTHER (too-large-to-list) branch, covered below.
    expect(mockMapCameraForBounds).not.toHaveBeenCalled();
    // Still a subtle recenter (same fixed-offset nudge a single marker's
    // selection uses), but with NO `zoom` key — proving this is the list
    // branch's nudge, not the zoom-to-bounds branch.
    expect(mockMapEaseTo).toHaveBeenCalledTimes(1);
    const [easeToOptions] = mockMapEaseTo.mock.calls[0] as [Record<string, unknown>];
    expect(easeToOptions.zoom).toBeUndefined();
    expect(easeToOptions.offset).toBeDefined();

    // The actual reveal: the sheet now shows all 3 members as rows.
    expect(
      screen.getByText(i18n.t("map.eventSheet.clusterListTitle", { count: "3" })),
    ).toBeTruthy();
    expect(screen.getByTestId("event-card-a")).toBeTruthy();
    expect(screen.getByTestId("event-card-b")).toBeTruthy();
    expect(screen.getByTestId("event-card-c")).toBeTruthy();
  });

  it("tapping a row inside an open cluster list swaps the sheet to that single event's own preview", async () => {
    setMockNextMapZoom(4);
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
    const [, featureCollection] = findClusterSetDataCall()!;

    const map = mockMapInstances.at(-1)!;
    await act(async () => {
      map.fireLayerEvent(
        "click",
        CLUSTER_CIRCLE_LAYER_ID,
        featureCollection.features[0]!.properties,
      );
    });
    expect(screen.getByTestId("event-card-b")).toBeTruthy();

    await act(async () => {
      fireEvent.press(screen.getByTestId("event-card-b"));
    });

    // The list is gone, replaced by event "b"'s own single-event preview —
    // the felt-report/open-full-event actions (list mode never renders
    // them) are back.
    expect(screen.queryByTestId("event-card-a")).toBeNull();
    expect(
      screen.getByRole("button", { name: i18n.t("felt.pill.label") }),
    ).toBeTruthy();
  });

  it("tapping a cluster PAST the list threshold zooms to its bounds instead of opening a list", async () => {
    setMockNextMapZoom(4);
    setMockCameraForBoundsResult({ center: [45.43, 35.56], zoom: CLUSTER_MAX_ZOOM + 2 });
    mockUseRegionEvents.mockReturnValue({
      events: makeManyCoLocatedEvents(CLUSTER_LIST_MAX_SIZE + 5),
      dataUpdatedAt: MOCK_DATA_UPDATED_AT,
    });

    await renderWithProviders(<MapScreenWeb />);
    await waitFor(() => {
      expect(findClusterSetDataCall()).toBeDefined();
    });
    const [, featureCollection] = findClusterSetDataCall()!;
    expect(featureCollection.features[0]?.properties.count).toBe(CLUSTER_LIST_MAX_SIZE + 5);

    const map = mockMapInstances.at(-1)!;
    mockMapCameraForBounds.mockClear();
    mockMapEaseTo.mockClear();
    await act(async () => {
      map.fireLayerEvent(
        "click",
        CLUSTER_CIRCLE_LAYER_ID,
        featureCollection.features[0]!.properties,
      );
    });

    expect(mockMapCameraForBounds).toHaveBeenCalledTimes(1);
    expect(mockMapEaseTo).toHaveBeenCalledWith(
      expect.objectContaining({ center: [45.43, 35.56], zoom: CLUSTER_MAX_ZOOM + 2 }),
    );
    // No list rendered for a too-large-to-list cluster.
    expect(screen.queryByText(/earthquakes/)).toBeNull();
  });

  it("forces the zoom past the cutoff when a large cluster's natural bounds-fit wouldn't clear it — a badge tap always makes progress", async () => {
    // Regression for the originally reported bug: a wide-spread cluster's
    // fit-bounds zoom can land AT/BELOW CLUSTER_MAX_ZOOM, which — with a
    // plain `fitBounds` call — re-clustered the exact same members into the
    // same badge (a tap that visibly changes nothing). `cameraForBounds`
    // here reports a natural zoom still below the cutoff; the resulting
    // camera move must clear it anyway.
    setMockNextMapZoom(4);
    setMockCameraForBoundsResult({ center: [45, 35], zoom: CLUSTER_MAX_ZOOM - 2 });
    mockUseRegionEvents.mockReturnValue({
      events: makeManyCoLocatedEvents(CLUSTER_LIST_MAX_SIZE + 5),
      dataUpdatedAt: MOCK_DATA_UPDATED_AT,
    });

    await renderWithProviders(<MapScreenWeb />);
    await waitFor(() => {
      expect(findClusterSetDataCall()).toBeDefined();
    });
    const [, featureCollection] = findClusterSetDataCall()!;

    const map = mockMapInstances.at(-1)!;
    mockMapEaseTo.mockClear();
    await act(async () => {
      map.fireLayerEvent(
        "click",
        CLUSTER_CIRCLE_LAYER_ID,
        featureCollection.features[0]!.properties,
      );
    });

    expect(mockMapEaseTo).toHaveBeenCalledTimes(1);
    const [easeToOptions] = mockMapEaseTo.mock.calls[0] as [{ zoom: number }];
    expect(easeToOptions.zoom).toBeGreaterThan(CLUSTER_MAX_ZOOM);
    expect(easeToOptions.zoom).toBe(CLUSTER_MAX_ZOOM + CLUSTER_EXPANSION_ZOOM_MARGIN);
  });

  it("does nothing if a large cluster's bounds can't be resolved to a camera (no undefined-camera crash)", async () => {
    setMockNextMapZoom(4);
    setMockCameraForBoundsResult(undefined);
    mockUseRegionEvents.mockReturnValue({
      events: makeManyCoLocatedEvents(CLUSTER_LIST_MAX_SIZE + 5),
      dataUpdatedAt: MOCK_DATA_UPDATED_AT,
    });

    await renderWithProviders(<MapScreenWeb />);
    await waitFor(() => {
      expect(findClusterSetDataCall()).toBeDefined();
    });
    const [, featureCollection] = findClusterSetDataCall()!;

    const map = mockMapInstances.at(-1)!;
    mockMapEaseTo.mockClear();
    await act(async () => {
      map.fireLayerEvent(
        "click",
        CLUSTER_CIRCLE_LAYER_ID,
        featureCollection.features[0]!.properties,
      );
    });

    expect(mockMapEaseTo).not.toHaveBeenCalled();
  });

  it("does nothing if a clicked cluster's id has no resolvable member events (defensive, should never happen in practice)", async () => {
    setMockNextMapZoom(4);
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
        id: "cluster-does-not-exist",
        count: 3,
        minLon: 45.4,
        maxLon: 45.5,
        minLat: 35.5,
        maxLat: 35.6,
      });
    });

    expect(mockMapEaseTo).not.toHaveBeenCalled();
  });
});

describe("MapScreenWeb clustering: cluster badges are visually distinct from magnitude markers", () => {
  it("paints the cluster circle layer with a neutral theme token, never colors.brand.primary or a magnitude status color", async () => {
    setMockNextMapZoom(4);
    mockUseRegionEvents.mockReturnValue({
      events: [
        makeEvent({ id: "a", lat: 35.56, lon: 45.43 }),
        makeEvent({ id: "b", lat: 35.56, lon: 45.43 }),
        makeEvent({ id: "c", lat: 35.56, lon: 45.43 }),
      ],
      dataUpdatedAt: MOCK_DATA_UPDATED_AT,
    });

    const { lightColors } = jest.requireActual("@/theme/semantic");

    await renderWithProviders(<MapScreenWeb />);
    await waitFor(() => {
      expect(findClusterSetDataCall()).toBeDefined();
    });

    const map = mockMapInstances.at(-1)!;
    const clusterCircleLayer = map
      .getStyle()
      .layers.find((layer) => layer.id === "bumelerze-event-clusters-circle") as
      | { paint?: Record<string, unknown> }
      | undefined;

    // Neutral chrome (`text.primary`), not the brand blue AND not any
    // magnitude `status.*` tone — the fix for badges and small-magnitude
    // ("info" tone) markers reading as the same kind of blue circle.
    expect(clusterCircleLayer?.paint?.["circle-color"]).toBe(lightColors.text.primary);
    expect(clusterCircleLayer?.paint?.["circle-color"]).not.toBe(lightColors.brand.primary);
    expect(clusterCircleLayer?.paint?.["circle-color"]).not.toBe(lightColors.status.info);
  });
});

describe("MapScreenWeb clustering: phone-width initial zoom (wall-of-badges fix)", () => {
  it("on a compact (phone-width) viewport, nudges the initial zoom in past a too-low bbox fit before the first clustering pass", async () => {
    setWindowWidth(360);
    setMockNextMapZoom(MAP_INITIAL_MIN_ZOOM_COMPACT - 1);
    mockUseRegionEvents.mockReturnValue({
      events: [makeEvent({ id: "a" })],
      dataUpdatedAt: MOCK_DATA_UPDATED_AT,
    });

    await renderWithProviders(<MapScreenWeb />);
    await waitFor(() => expect(mockMapJumpTo).toHaveBeenCalledWith({
      zoom: MAP_INITIAL_MIN_ZOOM_COMPACT,
    }));
  });

  it("does NOT nudge the zoom on a wide (desktop) viewport, even with the same too-low fitted zoom", async () => {
    setWindowWidth(1024);
    setMockNextMapZoom(MAP_INITIAL_MIN_ZOOM_COMPACT - 1);
    mockUseRegionEvents.mockReturnValue({
      events: [makeEvent({ id: "a" })],
      dataUpdatedAt: MOCK_DATA_UPDATED_AT,
    });

    await renderWithProviders(<MapScreenWeb />);
    await waitFor(() => expect(mockMarkerConstructorOptions).toHaveLength(1));
    expect(mockMapJumpTo).not.toHaveBeenCalled();
  });

  it("does NOT nudge the zoom on a compact viewport whose fitted zoom already clears the floor", async () => {
    setWindowWidth(360);
    setMockNextMapZoom(MAP_INITIAL_MIN_ZOOM_COMPACT + 1);
    mockUseRegionEvents.mockReturnValue({
      events: [makeEvent({ id: "a" })],
      dataUpdatedAt: MOCK_DATA_UPDATED_AT,
    });

    await renderWithProviders(<MapScreenWeb />);
    await waitFor(() => expect(mockMarkerConstructorOptions).toHaveLength(1));
    expect(mockMapJumpTo).not.toHaveBeenCalled();
  });
});
