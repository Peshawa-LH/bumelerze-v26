/**
 * @jest-environment jsdom
 *
 * Web Map screen (`app/(tabs)/map.web.tsx`) — map creation + marker
 * construction from the region feed. `maplibre-gl` is mocked at the module
 * boundary (wave brief: "no jsdom WebGL"); the jsdom environment override
 * is needed because the marker layer builds real DOM elements directly
 * (`document.createElement`), which the repo's default jest-expo/RN
 * environment doesn't provide a `document` for.
 */
import { cleanup, render, waitFor, type RenderResult } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import {
  makeEvent,
  MockAttributionControl,
  mockMapAddControl,
  MockMap,
  mockMapConstructorOptions,
  MockMarker,
  mockMarkerAddTo,
  mockMarkerConstructorOptions,
  mockMarkerSetLngLat,
  mockGetRTLTextPluginStatus,
  MOCK_DATA_UPDATED_AT,
  mockSetRTLTextPlugin,
  mockSetWorkerUrl,
  mockUseRegionEvents,
  mockUseWorldEvents,
  mockWorkerUrlCallOrder,
  resetMapWebMocks,
  setMockRTLTextPluginStatus,
  testSafeAreaMetrics,
} from "../__fixtures__/map-web-helpers";
import { MAP_RTL_TEXT_PLUGIN_URL, MAP_WORKER_URL } from "@/features/map";

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

// `{ virtual: true }`: maplibre-gl ships ESM-only (no CJS "require"/"default"
// export condition, verified in its package.json), which Jest's default CJS
// module resolution can't load — irrelevant here since the real package is
// never exercised, but `jest.mock` still tries to *resolve* the specifier
// unless told it's virtual.
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

// Imported after the mocks above so the mocked module graph is in place.
// Explicit `.web` suffix — this repo's jest-expo preset resolves the plain
// (native) platform by default, so a suffix-less import would silently
// resolve `map.tsx`, not this file.
// eslint-disable-next-line import/first -- see comment above
import MapScreenWeb from "../(tabs)/map.web";

async function renderWithProviders(ui: ReactElement): Promise<RenderResult> {
  // `render` is async in this installed `@testing-library/react-native`
  // version (14.x) — must be awaited, or its own internal `act()` overlaps
  // with whatever the test does next.
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

describe("MapScreenWeb creation", () => {
  it("creates a MapLibre map fitted to the region bbox, with an explicit always-expanded attribution control", async () => {
    await renderWithProviders(<MapScreenWeb />);

    await waitFor(() => {
      expect(mockMapConstructorOptions).toHaveLength(1);
    });
    const options = mockMapConstructorOptions[0];
    expect(options?.bounds).toEqual([
      [41.0, 33.0],
      [48.5, 38.5],
    ]);
    // The default `AttributionControl` is suppressed (`attributionControl:
    // false`) so an explicit instance can be added with `compact: false`
    // (always expanded, never hidden behind a toggle). No
    // `customAttribution` is passed — the vector source's own TileJSON
    // already supplies the correct credit line, and MapLibre collects that
    // automatically; adding a hand-typed copy on top is what used to
    // render the credit line twice (config.ts's `MAP_WORKER_URL` doc
    // comment has the full story).
    expect(options?.attributionControl).toBe(false);
    expect(mockMapAddControl).toHaveBeenCalledTimes(1);
    const [attributionControl] = mockMapAddControl.mock.calls[0] as [MockAttributionControl];
    expect(attributionControl.options).toEqual({ compact: false });
  });

  it("assigns the worker URL before constructing the map", async () => {
    await renderWithProviders(<MapScreenWeb />);

    await waitFor(() => {
      expect(mockMapConstructorOptions).toHaveLength(1);
    });

    // maplibre-gl reads its worker URL once, when the map spins up its
    // worker pool at construction time — assigning it any later would be a
    // no-op for that map instance. See MAP_WORKER_URL's doc comment
    // (config.ts) for why this needs to be an explicit, always-served
    // static file at all (maplibre-gl 6.x + Metro's web bundler).
    expect(mockSetWorkerUrl).toHaveBeenCalledWith(MAP_WORKER_URL);
    expect(mockWorkerUrlCallOrder).toEqual([
      `setWorkerUrl:${MAP_WORKER_URL}`,
      `setRTLTextPlugin:${MAP_RTL_TEXT_PLUGIN_URL}`,
      "mapConstructed",
    ]);
  });

  it("requests the RTL text plugin (lazy) before constructing the map, exactly once", async () => {
    await renderWithProviders(<MapScreenWeb />);

    await waitFor(() => {
      expect(mockMapConstructorOptions).toHaveLength(1);
    });

    expect(mockSetRTLTextPlugin).toHaveBeenCalledTimes(1);
    expect(mockSetRTLTextPlugin).toHaveBeenCalledWith(MAP_RTL_TEXT_PLUGIN_URL, true);
  });

  it("does not re-request the RTL text plugin when it was already requested earlier this session (idempotency guard)", async () => {
    // Simulates the REAL `maplibre-gl` singleton's state after an earlier
    // Map-tab mount already requested the plugin this page session (its
    // module-scope state persists across a screen remount/refocus, or the
    // MapTiler→OpenFreeMap runtime fallback recreating the map instance) —
    // a real `setRTLTextPlugin` throws "cannot be called multiple times" if
    // asked again while its status is anything other than `"unavailable"`.
    setMockRTLTextPluginStatus("deferred");

    await renderWithProviders(<MapScreenWeb />);
    await waitFor(() => {
      expect(mockMapConstructorOptions).toHaveLength(1);
    });

    expect(mockGetRTLTextPluginStatus).toHaveBeenCalled();
    expect(mockSetRTLTextPlugin).not.toHaveBeenCalled();
  });

  it("builds one marker per region event, positioned at its lon/lat", async () => {
    mockUseRegionEvents.mockReturnValue({
      events: [
        makeEvent({ id: "a", lat: 35.56, lon: 45.43 }),
        makeEvent({
          id: "b",
          lat: 36.19,
          lon: 44.01,
          magnitude: { value: 6.2, type: "mww" },
        }),
      ],
      dataUpdatedAt: MOCK_DATA_UPDATED_AT,
    });

    await renderWithProviders(<MapScreenWeb />);

    await waitFor(() => {
      expect(mockMarkerConstructorOptions).toHaveLength(2);
    });
    expect(mockMarkerSetLngLat).toHaveBeenNthCalledWith(1, [45.43, 35.56]);
    expect(mockMarkerSetLngLat).toHaveBeenNthCalledWith(2, [44.01, 36.19]);
    expect(mockMarkerAddTo).toHaveBeenCalledTimes(2);
  });
});
