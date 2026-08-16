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
  mockUseRegionEvents,
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
  it("creates a MapLibre map fitted to the region bbox, with explicit attribution", async () => {
    await renderWithProviders(<MapScreenWeb />);

    await waitFor(() => {
      expect(mockMapConstructorOptions).toHaveLength(1);
    });
    const options = mockMapConstructorOptions[0];
    expect(options?.bounds).toEqual([
      [41.0, 33.0],
      [48.5, 38.5],
    ]);
    // Attribution is added explicitly (OpenFreeMap's styles carry no
    // attribution string of their own) rather than left to the default
    // control, and never suppressed.
    expect(options?.attributionControl).toBe(false);
    expect(mockMapAddControl).toHaveBeenCalledTimes(1);
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
