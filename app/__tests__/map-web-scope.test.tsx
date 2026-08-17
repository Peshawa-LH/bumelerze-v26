/**
 * @jest-environment jsdom
 *
 * Web Map screen (`app/(tabs)/map.web.tsx`) — Kurdistan/World scope toggle
 * (update-plan-2026-08.md §4.1). See `map-web-creation.test.tsx`'s doc
 * comment for the jsdom-environment/mocking rationale.
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
import { WORLD_VIEW_BBOX } from "@/features/map";
import {
  makeEvent,
  MockAttributionControl,
  MockMap,
  mockMapFitBounds,
  MOCK_DATA_UPDATED_AT,
  MockMarker,
  mockMarkerConstructorOptions,
  mockMarkerRemove,
  mockMarkerSetLngLat,
  mockGetRTLTextPluginStatus,
  mockSetRTLTextPlugin,
  mockSetWorkerUrl,
  mockUseRegionEvents,
  mockUseWorldEvents,
  resetMapWebMocks,
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

beforeEach(() => {
  resetMapWebMocks();
});

afterEach(() => {
  cleanup();
});

describe("MapScreenWeb scope toggle", () => {
  it("defaults to Kurdistan (region feed markers only) and does not refit on initial mount", async () => {
    mockUseRegionEvents.mockReturnValue({
      events: [makeEvent({ id: "region-1" })],
      dataUpdatedAt: MOCK_DATA_UPDATED_AT,
    });
    mockUseWorldEvents.mockReturnValue({
      events: [makeEvent({ id: "world-1", lat: 10, lon: 10 })],
      dataUpdatedAt: MOCK_DATA_UPDATED_AT,
    });

    await renderWithProviders(<MapScreenWeb />);

    await waitFor(() => {
      expect(mockMarkerConstructorOptions).toHaveLength(1);
    });
    expect(mockMarkerSetLngLat).toHaveBeenCalledWith([45.43, 35.56]); // makeEvent's default lon/lat
    expect(mockMapFitBounds).not.toHaveBeenCalled();
    expect(
      screen.getByRole("radio", { name: i18n.t("map.scope.kurdistan") }),
    ).toBeTruthy();
    expect(screen.getByRole("radio", { name: i18n.t("map.scope.world") })).toBeTruthy();
  });

  it("switches the marker source to the world feed and refits to the world bbox when World is pressed", async () => {
    mockUseRegionEvents.mockReturnValue({
      events: [makeEvent({ id: "region-1" })],
      dataUpdatedAt: MOCK_DATA_UPDATED_AT,
    });
    mockUseWorldEvents.mockReturnValue({
      events: [
        makeEvent({ id: "world-1", lat: 10, lon: 10 }),
        makeEvent({ id: "world-2", lat: -20, lon: 130 }),
      ],
      dataUpdatedAt: MOCK_DATA_UPDATED_AT,
    });

    await renderWithProviders(<MapScreenWeb />);
    await waitFor(() => {
      expect(mockMarkerConstructorOptions).toHaveLength(1);
    });

    const worldButton = screen.getByRole("radio", { name: i18n.t("map.scope.world") });
    await act(async () => {
      fireEvent.press(worldButton);
    });

    // The old Kurdistan marker is torn down, two new World markers built
    // (constructor log accumulates across the whole test — 1 initial + 2
    // new — rather than resetting on rebuild).
    await waitFor(() => {
      expect(mockMarkerConstructorOptions).toHaveLength(3);
    });
    expect(mockMarkerRemove).toHaveBeenCalledTimes(1);
    const lastTwoPositions = mockMarkerSetLngLat.mock.calls.slice(-2);
    expect(lastTwoPositions).toEqual([[[10, 10]], [[130, -20]]]);

    expect(mockMapFitBounds).toHaveBeenCalledTimes(1);
    const [bounds] = mockMapFitBounds.mock.calls[0] as [
      [[number, number], [number, number]],
    ];
    expect(bounds).toEqual([
      [WORLD_VIEW_BBOX.minLon, WORLD_VIEW_BBOX.minLat],
      [WORLD_VIEW_BBOX.maxLon, WORLD_VIEW_BBOX.maxLat],
    ]);
  });

  it("refits back to the Kurdistan region bbox when switching back", async () => {
    mockUseRegionEvents.mockReturnValue({
      events: [makeEvent({ id: "region-1" })],
      dataUpdatedAt: MOCK_DATA_UPDATED_AT,
    });
    mockUseWorldEvents.mockReturnValue({
      events: [makeEvent({ id: "world-1" })],
      dataUpdatedAt: MOCK_DATA_UPDATED_AT,
    });

    await renderWithProviders(<MapScreenWeb />);
    await waitFor(() => {
      expect(mockMarkerConstructorOptions).toHaveLength(1);
    });

    await act(async () => {
      fireEvent.press(screen.getByRole("radio", { name: i18n.t("map.scope.world") }));
    });
    await waitFor(() => expect(mockMapFitBounds).toHaveBeenCalledTimes(1));

    await act(async () => {
      fireEvent.press(screen.getByRole("radio", { name: i18n.t("map.scope.kurdistan") }));
    });
    await waitFor(() => expect(mockMapFitBounds).toHaveBeenCalledTimes(2));

    const [secondBounds] = mockMapFitBounds.mock.calls[1] as [
      [[number, number], [number, number]],
    ];
    expect(secondBounds).toEqual([
      [41.0, 33.0],
      [48.5, 38.5],
    ]);
  });
});
